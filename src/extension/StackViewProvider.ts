import { mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { BranchNamingUtils } from '../git/branchNaming';
import { GitClient } from '../git/gitClient';
import { PeacockColorUtils } from '../git/peacockColor';
import { GitStackStateLoader } from '../git/stackState/loader';
import { WorktreeNamingUtils } from '../git/worktreeNaming';
import { GitHubClient } from '../github/githubClient';
import { GitHubRemoteUtils } from '../github/remote';
import type {
  HostToWebviewMessage,
  RebaseIntent,
  RebaseIntentNode,
  StackBranch,
  StackState,
  WebviewToHostMessage,
} from '../protocol';
import { RebaseQueueExecutor, type QueueRunOutcome } from '../rebase/executor';
import { isRebaseIntentValid } from '../rebase/intent';
import { applyRebaseIntentToState } from '../rebase/project';
import { QueueBuilderUtils } from '../rebase/queueBuilder';
import { OperationQueueStore } from '../rebase/queueStore';
import { GitHubAuthUtils } from '../github/auth';
import { GitHubPrEnricher } from './githubPrEnricher';
import { GitRefsWatcher } from './gitWatcher';
import { ScmGitApiUtils } from './scmGitApi';
import { renderStackWebviewHtml } from './webviewHtml';

export class StackViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private gitWatcher: GitRefsWatcher | undefined;
  private watchedRepoRoot: string | null = null;
  private cachedStackState: StackState | null = null;
  private cachedWorkspaceRoot: string | null = null;
  private pendingRebase: RebaseIntent | null = null;
  private operationChain: Promise<void> = Promise.resolve();
  private refreshTask: Promise<void> | null = null;
  private refreshPending = false;
  private refreshId = 0;
  private reconciling = false;
  private readonly prEnricher = new GitHubPrEnricher();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.prEnricher.invalidateAll();
        void this.refresh();
      }),
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === 'github') {
          this.prEnricher.invalidateAuth();
          void this.updateGitHubAuthContext();
          void this.refresh();
        }
      })
    );

    void this.updateGitHubAuthContext();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.disposeViewState();
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')],
    };
    view.webview.html = renderStackWebviewHtml(this.context.extensionUri, view.webview);

    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        this.enqueueOperation(() => this.handleWebviewMessage(message));
      }),
      view.onDidChangeVisibility(() => {
        if (view.visible) {
          void this.refresh();
        }
      }),
      view.onDidDispose(() => {
        this.disposeViewState();
      })
    );

    this.attachGitWatcher();
    await this.invalidateCurrentGitHubPulls();
    await this.refresh();
  }

  copyBranchName(branchRef: string): void {
    this.enqueueOperation(() => this.performCopyBranchName(branchRef));
  }

  checkoutBranch(branchRef: string): void {
    this.enqueueOperation(() => this.performCheckoutBranch(branchRef));
  }

  renameBranch(branchRef: string): void {
    this.enqueueOperation(() => this.performRenameBranch(branchRef));
  }

  deleteBranch(branchRef: string): void {
    this.enqueueOperation(() => this.performDeleteBranch(branchRef));
  }

  amendCommitMessage(commitSha: string, currentMessage: string): void {
    this.enqueueOperation(() => this.performAmendCommitMessage(commitSha, currentMessage));
  }

  createBranchAtCommit(commitSha: string): void {
    this.enqueueOperation(() => this.performCreateBranchAtCommit(commitSha));
  }

  deleteWorktree(branchRef: string, worktreePath: string): void {
    this.enqueueOperation(() => this.performDeleteWorktree(branchRef, worktreePath));
  }

  createWorktree(branchRef: string): void {
    this.enqueueOperation(() => this.performCreateWorktree(branchRef));
  }

  createPullRequest(branchRef: string): void {
    this.enqueueOperation(() => this.performCreatePullRequest(branchRef));
  }

  signInToGitHub(): void {
    this.enqueueOperation(() => this.performSignInToGitHub());
  }

  createWorkingCommit(): void {
    this.enqueueOperation(() => this.performCreateWorkingCommit());
  }

  branchAndCommit(): void {
    this.enqueueOperation(() => this.performBranchAndCommit());
  }

  amendAndRebase(): void {
    this.enqueueOperation(() => this.performAmendAndRebase());
  }

  pullTrunk(): void {
    this.enqueueOperation(() => this.performPullTrunk());
  }

  async refresh(): Promise<void> {
    this.refreshPending = true;
    if (this.refreshTask) {
      await this.refreshTask;
      return;
    }

    this.refreshTask = this.runRefreshLoop();

    try {
      await this.refreshTask;
    } finally {
      this.refreshTask = null;
    }
  }

  dispose(): void {
    this.disposeViewState();
    vscode.Disposable.from(...this.disposables).dispose();
    this.disposables.length = 0;
  }

  private getWorkspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private enqueueOperation(operation: () => Promise<void>): void {
    this.operationChain = this.operationChain
      .catch(() => undefined)
      .then(operation)
      .catch((error) => {
        void vscode.window.showErrorMessage(toErrorMessage(error));
      });
  }

  private async handleWebviewMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        const cached = this.cachedStackState;
        if (cached && this.view) {
          const projected = this.projectPendingRebase(cached);
          await this.view.webview.postMessage({ type: 'stack', state: projected });
        }
        await this.refresh();
        return;
      }
      case 'refresh':
        await this.refresh();
        return;
      case 'submitRebaseIntent':
        await this.submitRebaseIntent(message.intent);
        return;
      case 'confirmRebaseIntent':
        await this.confirmRebaseIntent();
        return;
      case 'cancelRebaseIntent':
        await this.cancelRebaseIntent();
        return;
      case 'continueRebase':
        await this.performContinueRebase();
        return;
      case 'abortRebase':
        await this.performAbortRebase();
        return;
      case 'checkoutBranch':
        await this.performCheckoutBranch(message.branchRef);
        return;
      case 'pickBranchAction':
        await this.performPickBranchAction(message.branchRefs);
        return;
      case 'forcePushBranch':
        await this.performForcePushBranch(message.branchRef);
        return;
      case 'createPullRequest':
        await this.performCreatePullRequest(message.branchRef);
        return;
      case 'createBranchAtCommit':
        this.createBranchAtCommit(message.commitSha);
        return;
      case 'amendAndRebase':
        this.amendAndRebase();
        return;
      case 'branchAndCommit':
        this.branchAndCommit();
        return;
      case 'pullTrunk':
        await this.performPullTrunk();
        return;
    }
  }

  private attachGitWatcher(explicitRepoRoot?: string): void {
    const repoRoot = explicitRepoRoot ?? this.getWorkspaceRoot();
    if (!repoRoot || repoRoot === this.watchedRepoRoot) {
      return;
    }

    this.disposeGitWatcher();
    this.gitWatcher = new GitRefsWatcher(repoRoot, () => {
      void this.refresh();
    }, {
      onRepoConfigChange: () => {
        this.prEnricher.invalidateRepo(repoRoot);
      },
    });
    this.watchedRepoRoot = repoRoot;
  }

  private disposeViewState(): void {
    this.disposeGitWatcher();
    this.pendingRebase = null;
    this.refreshPending = false;
    vscode.Disposable.from(...this.viewDisposables).dispose();
    this.viewDisposables.length = 0;
    this.view = undefined;
  }

  private disposeGitWatcher(): void {
    this.gitWatcher?.dispose();
    this.gitWatcher = undefined;
    this.watchedRepoRoot = null;
  }

  private projectPendingRebase(state: StackState): StackState {
    if (!this.pendingRebase) {
      return state;
    }

    if (!isRebaseIntentValid(state, this.pendingRebase)) {
      this.pendingRebase = null;
      return state;
    }

    return applyRebaseIntentToState(state, this.pendingRebase);
  }

  private async submitRebaseIntent(intent: RebaseIntent): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const state = await this.getStateForUiInteraction(workspaceRoot);
    if (!isRebaseIntentValid(state, intent)) {
      this.pendingRebase = null;
      await this.presentState(state, workspaceRoot);
      return;
    }

    this.pendingRebase = intent;
    await this.presentState(state, workspaceRoot);
  }

  private async confirmRebaseIntent(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const intent = this.pendingRebase;
    if (!workspaceRoot || !intent) {
      return;
    }

    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      return;
    }

    if (await this.rejectIfOperationInProgress(git, workspaceRoot)) {
      this.pendingRebase = null;
      await this.refresh();
      return;
    }

    const repoRoot = git.getRepoRoot();
    const originalBranch = await git.getCurrentBranch();
    const store = new OperationQueueStore(repoRoot);
    const queue = QueueBuilderUtils.fromIntent(intent, {
      repoRoot,
      originalBranchRef: originalBranch,
      label: `Rebase ${intent.root.branchRef}`,
    });

    this.pendingRebase = null;
    await store.save(queue);

    const executor = new RebaseQueueExecutor(repoRoot, store);
    const outcome = await executor.runUntilBlocked(queue);
    await this.handleQueueOutcome(outcome);
  }

  private async cancelRebaseIntent(): Promise<void> {
    this.pendingRebase = null;
    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.getStateForUiInteraction(workspaceRoot);
    await this.presentState(state, workspaceRoot);
  }

  private async performCheckoutBranch(branchRef: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }
    await git.checkout(branchRef);
    void vscode.commands.executeCommand('git.refresh');
    await this.refresh();
  }

  private async performPickBranchAction(branchRefs: string[]): Promise<void> {
    if (branchRefs.length === 0) {
      return;
    }
    const branch = await vscode.window.showQuickPick(branchRefs, {
      placeHolder: 'Select a branch',
    });
    if (!branch) {
      return;
    }
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Checkout', value: 'checkout' as const },
        { label: 'Delete', value: 'delete' as const },
      ],
      { placeHolder: `Action for ${branch}` }
    );
    if (!action) {
      return;
    }
    if (action.value === 'checkout') {
      await this.performCheckoutBranch(branch);
    } else {
      await this.performDeleteBranch(branch);
    }
  }

  private async performBranchAndCommit(): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    if (!(await git.hasStagedChanges())) {
      void vscode.window.showErrorMessage('No staged changes to commit. Stage changes first.');
      return;
    }

    const message = (await this.readScmInputValue(git.getRepoRoot())).trim();
    if (!message) {
      void vscode.window.showErrorMessage(
        'Enter a commit message in the Source Control input box first.'
      );
      return;
    }

    const existing = new Set((await git.listLocalBranches()).map((b) => b.name));
    const branchName = BranchNamingUtils.generate(existing);

    await git.createAndCheckoutBranch(branchName);
    await git.commitChanges(message);
    await this.clearScmInputValue(git.getRepoRoot());

    void vscode.commands.executeCommand('git.refresh');
    await this.refresh();
  }

  private async performAmendAndRebase(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      void vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      void vscode.window.showErrorMessage('Not a git repository');
      return;
    }

    if (!(await git.hasAnyChanges())) {
      void vscode.window.showInformationMessage('No changes to amend.');
      return;
    }

    const state = await this.loadGitOnlyState(workspaceRoot);
    if (state.error) {
      void vscode.window.showErrorMessage(state.error);
      return;
    }

    const currentBranch = state.branches.find((b) => b.isCurrent);
    if (!currentBranch) {
      void vscode.window.showErrorMessage(
        'Cannot amend: HEAD is detached or not on a tracked branch.'
      );
      return;
    }

    const repoRoot = state.repoRoot ?? git.getRepoRoot();

    if (await this.rejectIfOperationInProgress(git, repoRoot)) {
      return;
    }

    const branchesByRef = new Map(state.branches.map((b) => [b.ref, b]));
    const subtrees: RebaseIntentNode[] = currentBranch.childRefs.map((ref) =>
      buildIntentNode(branchesByRef, ref)
    );

    const inputMessage = (await this.readScmInputValue(repoRoot)).trim();
    await git.amendChanges({ message: inputMessage || undefined });
    const newHead = await git.revParse('HEAD');

    await this.clearScmInputValue(repoRoot);

    if (subtrees.length === 0) {
      void vscode.commands.executeCommand('git.refresh');
      await this.refresh();
      return;
    }

    const originalBranch = currentBranch.ref;
    const store = new OperationQueueStore(repoRoot);
    const queue = QueueBuilderUtils.fromSubtrees(
      subtrees,
      { kind: 'sha', sha: newHead },
      {
        repoRoot,
        originalBranchRef: originalBranch,
        label:
          subtrees.length === 1
            ? `Amend & rebase ${subtrees[0].branchRef}`
            : `Amend & rebase ${subtrees.length} branches`,
      }
    );

    await store.save(queue);
    void vscode.commands.executeCommand('git.refresh');

    const executor = new RebaseQueueExecutor(repoRoot, store);
    const outcome = await executor.runUntilBlocked(queue);
    await this.handleQueueOutcome(outcome);
  }

  private async performContinueRebase(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      return;
    }

    const repoRoot = git.getRepoRoot();
    const store = new OperationQueueStore(repoRoot);

    try {
      await git.rebaseContinue();
    } catch (error) {
      const message = toErrorMessage(error);
      if (/no rebase in progress/i.test(message)) {
        // Fall through — rebase may already be resolved externally.
      } else if ((await git.hasActiveRebase()) !== null) {
        void vscode.window.showErrorMessage(message);
        await this.refresh();
        return;
      } else {
        void vscode.window.showErrorMessage(message);
        await store.clear();
        await this.refresh();
        return;
      }
    }

    const queue = await store.load();
    if (!queue) {
      await this.refresh();
      return;
    }

    const current = queue.steps[queue.cursor];
    if (current?.kind === 'rebase-branch') {
      try {
        queue.completedHeads[current.id] = await git.revParse(current.branchRef);
      } catch {
        // If the branch somehow vanished, give up gracefully.
        await store.clear();
        await this.refresh();
        return;
      }
      queue.cursor += 1;
      await store.save(queue);
    }

    const executor = new RebaseQueueExecutor(repoRoot, store);
    const outcome = await executor.runUntilBlocked(queue);
    void vscode.commands.executeCommand('git.refresh');
    await this.handleQueueOutcome(outcome);
  }

  private async performAbortRebase(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      return;
    }

    const repoRoot = git.getRepoRoot();
    const store = new OperationQueueStore(repoRoot);

    try {
      await git.rebaseAbort();
    } catch (error) {
      void vscode.window.showErrorMessage(toErrorMessage(error));
    }

    await store.clear();
    void vscode.commands.executeCommand('git.refresh');
    await this.refresh();
  }

  private async handleQueueOutcome(outcome: QueueRunOutcome): Promise<void> {
    if (outcome.kind === 'error') {
      void vscode.window.showErrorMessage(toErrorMessage(outcome.error));
    }
    void vscode.commands.executeCommand('git.refresh');
    await this.refresh();
  }

  private async rejectIfOperationInProgress(
    git: GitClient,
    repoRoot: string
  ): Promise<boolean> {
    const store = new OperationQueueStore(repoRoot);
    const [active, existing] = await Promise.all([git.hasActiveRebase(), store.load()]);
    if (active !== null || existing !== null) {
      void vscode.window.showErrorMessage(
        'A teapot rebase is already in progress. Resolve it via Continue/Abort first.'
      );
      return true;
    }
    return false;
  }

  private async reconcileQueueIfIdle(workspaceRoot: string | null): Promise<void> {
    if (this.reconciling || !workspaceRoot) {
      return;
    }

    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      return;
    }

    const repoRoot = git.getRepoRoot();
    const store = new OperationQueueStore(repoRoot);
    const queue = await store.load();
    if (!queue) {
      return;
    }

    if ((await git.hasActiveRebase()) !== null) {
      return; // still paused; UI surfaces Abort/Continue
    }

    this.reconciling = true;
    try {
      const current = queue.steps[queue.cursor];
      if (!current) {
        await store.clear();
        return;
      }

      if (current.kind === 'restore-head') {
        const executor = new RebaseQueueExecutor(repoRoot, store);
        const outcome = await executor.runUntilBlocked(queue);
        await this.handleQueueOutcome(outcome);
        return;
      }

      let currentHead: string | null;
      try {
        currentHead = await git.revParse(current.branchRef);
      } catch {
        currentHead = null;
      }

      if (currentHead === null || currentHead === current.preRebaseHeadSha) {
        // External abort, or branch deleted — drop the queue.
        await store.clear();
        await this.refresh();
        return;
      }

      // External continue — record head, advance, resume.
      queue.completedHeads[current.id] = currentHead;
      queue.cursor += 1;
      await store.save(queue);
      const executor = new RebaseQueueExecutor(repoRoot, store);
      const outcome = await executor.runUntilBlocked(queue);
      await this.handleQueueOutcome(outcome);
    } finally {
      this.reconciling = false;
    }
  }

  private async readScmInputValue(repoRoot: string): Promise<string> {
    const api = await ScmGitApiUtils.getApi();
    if (!api) return '';
    const repo = ScmGitApiUtils.findRepository(api, repoRoot);
    return repo?.inputBox.value ?? '';
  }

  private async clearScmInputValue(repoRoot: string): Promise<void> {
    const api = await ScmGitApiUtils.getApi();
    if (!api) return;
    const repo = ScmGitApiUtils.findRepository(api, repoRoot);
    if (repo) {
      repo.inputBox.value = '';
    }
  }

  private async performCreateWorkingCommit(): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    const currentBranch = await git.getCurrentBranch();
    if (!currentBranch) {
      void vscode.window.showErrorMessage(
        'Cannot create a working commit from a detached HEAD.'
      );
      return;
    }

    const existing = new Set((await git.listLocalBranches()).map((b) => b.name));
    const branchName = BranchNamingUtils.generate(existing);

    const newSha = await git.createEmptyCommitOnTop('HEAD', 'chore: wip');
    await git.createBranchAt(branchName, newSha);
    await git.checkout(branchName);

    void vscode.commands.executeCommand('git.refresh');
    await this.refresh();
  }

  private async performCopyBranchName(branchRef: string): Promise<void> {
    await vscode.env.clipboard.writeText(branchRef);
    void vscode.window.showInformationMessage(`Copied "${branchRef}" to clipboard`);
  }

  private async performRenameBranch(branchRef: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    const existingBranches = new Set(
      (await git.listLocalBranches()).map((branch) => branch.name)
    );

    const newName = await vscode.window.showInputBox({
      title: 'Rename Branch',
      prompt: `Rename "${branchRef}" to...`,
      value: branchRef,
      valueSelection: [0, branchRef.length],
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Branch name cannot be empty';
        }
        if (/\s/.test(trimmed)) {
          return 'Branch name cannot contain whitespace';
        }
        if (trimmed === branchRef) {
          return 'Branch name is unchanged';
        }
        if (existingBranches.has(trimmed)) {
          return `A branch named "${trimmed}" already exists`;
        }
        return null;
      },
    });

    if (!newName) {
      return;
    }

    await git.renameBranch(branchRef, newName.trim());
    await this.refresh();
  }

  private async performDeleteBranch(branchRef: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.getStateForUiInteraction(workspaceRoot);
    const branch = state.branches.find((candidate) => candidate.ref === branchRef);
    if (!branch) {
      void vscode.window.showErrorMessage(`Branch "${branchRef}" not found.`);
      return;
    }
    if (branch.isCurrent) {
      void vscode.window.showErrorMessage(
        `Cannot delete "${branchRef}" because it is the current branch.`
      );
      return;
    }
    if (branch.isTrunk) {
      void vscode.window.showErrorMessage(`Cannot delete the trunk branch "${branchRef}".`);
      return;
    }

    const git = await this.openGit();
    if (!git) {
      return;
    }

    await git.deleteBranch(branchRef);
    await this.refresh();
  }

  private async performAmendCommitMessage(
    commitSha: string,
    currentMessage: string
  ): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.getStateForUiInteraction(workspaceRoot);
    const currentBranch = state.branches.find((branch) => branch.isCurrent);
    if (!currentBranch || currentBranch.headSha !== commitSha) {
      void vscode.window.showWarningMessage(
        'Cannot amend: HEAD is no longer on this commit.'
      );
      return;
    }

    const newMessage = await vscode.window.showInputBox({
      title: 'Amend Commit Message',
      prompt: 'Rewrites the current commit with a new message',
      value: currentMessage,
      validateInput: (value) => (value.trim() ? null : 'Commit message cannot be empty'),
    });

    if (newMessage === undefined) {
      return;
    }

    const git = await this.openGit();
    if (!git) {
      return;
    }

    await git.amendCommitMessage(newMessage.trim());
    await this.refresh();
  }

  private async performCreateBranchAtCommit(commitSha: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    const existing = new Set((await git.listLocalBranches()).map((b) => b.name));
    const branchName = BranchNamingUtils.generate(existing);

    await git.createBranchAt(branchName, commitSha);
    await this.refresh();
    void vscode.window.showInformationMessage(
      `Created branch "${branchName}" at ${commitSha.slice(0, 7)}`
    );
  }

  private async performDeleteWorktree(branchRef: string, worktreePath: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    try {
      await git.removeWorktree(worktreePath);
    } catch (error) {
      const message = toErrorMessage(error);
      const looksDirty = /dirty|modified|contains|uncommitted|untracked|locked/i.test(message);
      if (!looksDirty) {
        throw error;
      }

      const choice = await vscode.window.showWarningMessage(
        `Worktree at "${worktreePath}" has uncommitted or untracked changes.`,
        { modal: true, detail: message },
        'Force Delete'
      );
      if (choice !== 'Force Delete') {
        return;
      }
      await git.removeWorktree(worktreePath, { force: true });
    }

    await this.refresh();
    void vscode.window.showInformationMessage(
      `Removed worktree for "${branchRef}"`
    );
  }

  private async performSignInToGitHub(): Promise<void> {
    const session = await GitHubAuthUtils.promptForSession();
    this.prEnricher.invalidateAuth();
    await this.updateGitHubAuthContext();
    if (!session) {
      return;
    }
    await this.refresh();
  }

  private async performCreatePullRequest(branchRef: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.getStateForUiInteraction(workspaceRoot);
    const branch = state.branches.find((candidate) => candidate.ref === branchRef);
    if (!branch) {
      void vscode.window.showErrorMessage(`Branch "${branchRef}" not found.`);
      return;
    }
    if (branch.pullRequest) {
      void vscode.window.showInformationMessage(
        `Branch "${branchRef}" already has a pull request.`
      );
      return;
    }

    const baseRef = this.getPullRequestBaseBranch(state, branchRef);
    if (!baseRef) {
      void vscode.window.showErrorMessage(
        `Cannot create a pull request for "${branchRef}" because its base branch is not eligible.`
      );
      return;
    }

    const git = await this.openGit();
    if (!git) {
      return;
    }

    const remoteUrl = await git.getRemoteUrl('origin');
    const repo = remoteUrl ? GitHubRemoteUtils.parse(remoteUrl) : null;
    if (!repo) {
      void vscode.window.showErrorMessage('Origin is not a GitHub remote');
      return;
    }

    try {
      await git.forcePushBranch(branchRef);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to push "${branchRef}" before creating PR: ${toErrorMessage(error)}`
      );
      return;
    }

    const session = await GitHubAuthUtils.promptForSession();
    this.prEnricher.invalidateAuth();
    await this.updateGitHubAuthContext();
    if (!session) {
      return;
    }

    try {
      const title = branch.commits[0]?.message.trim() || branch.ref;
      const client = new GitHubClient(session.accessToken);
      const pull = await client.createPullRequest(repo.owner, repo.repo, {
        title,
        head: branch.ref,
        base: baseRef,
      });

      this.prEnricher.invalidatePulls(git.getRepoRoot());
      await this.refresh();

      const choice = await vscode.window.showInformationMessage(
        `Created pull request #${pull.number} for "${branchRef}"`,
        'Open Pull Request'
      );
      if (choice === 'Open Pull Request') {
        await vscode.env.openExternal(vscode.Uri.parse(pull.html_url));
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to create pull request for "${branchRef}": ${toErrorMessage(error)}`
      );
    }
  }

  private async performPullTrunk(): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.getStateForUiInteraction(workspaceRoot);
    const trunk = state.trunk;
    if (!trunk) {
      void vscode.window.showErrorMessage('No trunk branch detected.');
      return;
    }

    const remoteRef = `origin/${trunk}`;

    try {
      await git.fetch('origin');
      await git.revParse(remoteRef);

      if (!(await git.branchExists(trunk))) {
        await git.createBranchAt(trunk, remoteRef);
      } else {
        const worktrees = await git.listWorktrees();
        const trunkWorktree = worktrees.find((w) => w.branch === trunk);
        if (trunkWorktree) {
          await git.mergeFastForwardOnlyInWorktree(trunkWorktree.path, remoteRef);
        } else {
          await git.fetchRefFastForward('origin', trunk);
        }
      }

      void vscode.commands.executeCommand('git.refresh');
      void vscode.window.showInformationMessage(`Pulled ${trunk} from origin`);
      await this.refresh();
    } catch (error) {
      const message = toErrorMessage(error);
      const divergenceHint = /non-fast-forward|rejected|would clobber/i.test(message)
        ? ` — ${trunk} has diverged from origin`
        : '';
      void vscode.window.showErrorMessage(
        `Failed to pull ${trunk}${divergenceHint}: ${message}`
      );
    }
  }

  private async performForcePushBranch(branchRef: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    try {
      await git.forcePushBranch(branchRef);
      this.prEnricher.invalidatePulls(git.getRepoRoot());
      void vscode.window.showInformationMessage(`Force pushed "${branchRef}"`);
      await this.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to push "${branchRef}": ${toErrorMessage(error)}`
      );
    }
  }

  private async updateGitHubAuthContext(): Promise<void> {
    let valid = false;
    try {
      const session = await GitHubAuthUtils.getSilentSession();
      valid = !!session;
    } catch {
      valid = false;
    }
    await vscode.commands.executeCommand(
      'setContext',
      'teapot.gitHubSessionValid',
      valid
    );
  }

  private async invalidateCurrentGitHubPulls(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      return;
    }

    this.prEnricher.invalidatePulls(git.getRepoRoot());
  }

  private getPullRequestBaseBranch(state: StackState, branchRef: string): string | null {
    const branchesByRef = new Map(state.branches.map((branch) => [branch.ref, branch]));
    const branch = branchesByRef.get(branchRef);
    if (!branch?.parentRef) {
      return null;
    }

    const parent = branchesByRef.get(branch.parentRef);
    if (!parent) {
      return null;
    }

    return parent.isTrunk || parent.pullRequest ? parent.ref : null;
  }

  private async performCreateWorktree(branchRef: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.getStateForUiInteraction(workspaceRoot);
    const branch = state.branches.find((candidate) => candidate.ref === branchRef);
    if (!branch) {
      void vscode.window.showErrorMessage(`Branch "${branchRef}" not found.`);
      return;
    }
    if (branch.isCurrent) {
      void vscode.window.showErrorMessage(
        `Cannot create a worktree for "${branchRef}" because it is the current branch.`
      );
      return;
    }
    if (branch.worktreePath) {
      void vscode.window.showErrorMessage(
        `Branch "${branchRef}" already has a worktree at ${branch.worktreePath}.`
      );
      return;
    }

    const repoRoot = git.getRepoRoot();
    const worktreesDir = join(dirname(repoRoot), `${basename(repoRoot)}-worktrees`);
    await mkdir(worktreesDir, { recursive: true });

    const taken = await readExistingEntries(worktreesDir);
    const animal = WorktreeNamingUtils.pickAnimal(taken);
    const worktreePath = join(worktreesDir, animal);
    const color = WorktreeNamingUtils.pickColor();

    await git.addWorktree(worktreePath, branchRef);
    await PeacockColorUtils.writeForWorktree(worktreePath, color);

    await this.refresh();
    void vscode.window.showInformationMessage(
      `Created worktree "${animal}" for "${branchRef}"`
    );
  }

  private async openGit(): Promise<GitClient | null> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      void vscode.window.showErrorMessage('No workspace folder open');
      return null;
    }
    const git = await GitClient.open(workspaceRoot);
    if (!git) {
      void vscode.window.showErrorMessage('Not a git repository');
      return null;
    }
    return git;
  }

  private async loadGitOnlyState(workspaceRoot: string | null): Promise<StackState> {
    if (!workspaceRoot) {
      this.cachedWorkspaceRoot = null;
      this.cachedStackState = {
        branches: [],
        trunk: null,
        current: null,
        repoRoot: null,
        error: 'No workspace folder open',
        pendingRebase: null,
        activeRebase: null,
      };
      return this.cachedStackState;
    }

    this.cachedWorkspaceRoot = workspaceRoot;
    const loaded = await GitStackStateLoader.load(workspaceRoot);
    this.cachedStackState = loaded;
    return loaded;
  }

  private async loadStackState(workspaceRoot: string | null): Promise<StackState> {
    const gitState = await this.loadGitOnlyState(workspaceRoot);
    if (!workspaceRoot) {
      return gitState;
    }
    const enriched = await this.enrichWithPullRequests(gitState, workspaceRoot);
    this.cachedStackState = enriched;
    return enriched;
  }

  private async enrichWithPullRequests(
    state: StackState,
    workspaceRoot: string
  ): Promise<StackState> {
    if (state.error || state.branches.length === 0) {
      return state;
    }

    const repoRoot = state.repoRoot ?? workspaceRoot;

    try {
      const prByBranch = await this.prEnricher.enrich(repoRoot, state.branches);
      if (prByBranch.size === 0) {
        return state;
      }

      return {
        ...state,
        branches: state.branches.map((branch) => ({
          ...branch,
          pullRequest: prByBranch.get(branch.ref) ?? null,
        })),
      };
    } catch (error) {
      console.warn('teapot: failed to enrich with GitHub PRs', error);
      return state;
    }
  }

  private async presentState(
    state: StackState,
    workspaceRoot: string | null = this.getWorkspaceRoot()
  ): Promise<void> {
    if (!this.view) {
      return;
    }

    const projectedState = this.projectPendingRebase(state);
    const message: HostToWebviewMessage = { type: 'stack', state: projectedState };
    await this.view.webview.postMessage(message);

    const repoRoot = projectedState.repoRoot ?? workspaceRoot;
    if (!repoRoot) {
      this.disposeGitWatcher();
      return;
    }

    if (repoRoot !== this.watchedRepoRoot) {
      this.attachGitWatcher(repoRoot);
    }
  }

  private getCachedStackState(workspaceRoot: string | null): StackState | null {
    if (!workspaceRoot || !this.cachedStackState || this.cachedWorkspaceRoot !== workspaceRoot) {
      return null;
    }

    return this.cachedStackState;
  }

  private async getStateForUiInteraction(workspaceRoot: string | null): Promise<StackState> {
    if (!workspaceRoot) {
      return this.loadStackState(workspaceRoot);
    }

    return this.getCachedStackState(workspaceRoot) ?? this.loadStackState(workspaceRoot);
  }

  private async runRefreshLoop(): Promise<void> {
    while (this.refreshPending) {
      this.refreshPending = false;

      if (!this.view) {
        return;
      }

      const myId = ++this.refreshId;
      const workspaceRoot = this.getWorkspaceRoot();
      const gitState = await this.loadGitOnlyState(workspaceRoot);

      if (myId !== this.refreshId || !this.view) {
        continue;
      }
      await this.presentState(gitState, workspaceRoot);

      if (workspaceRoot && !gitState.error && gitState.branches.length > 0) {
        void this.enrichAndPresent(gitState, workspaceRoot, myId);
      }

      if (workspaceRoot) {
        void this.reconcileQueueIfIdle(workspaceRoot);
      }
    }
  }

  private async enrichAndPresent(
    base: StackState,
    workspaceRoot: string,
    id: number
  ): Promise<void> {
    try {
      const enriched = await this.enrichWithPullRequests(base, workspaceRoot);
      if (id !== this.refreshId || !this.view) {
        return;
      }
      if (enriched === base) {
        return;
      }
      this.cachedStackState = enriched;
      await this.presentState(enriched, workspaceRoot);
    } catch (error) {
      console.warn('teapot: PR enrichment failed', error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildIntentNode(
  branchesByRef: Map<string, StackBranch>,
  branchRef: string
): RebaseIntentNode {
  const branch = branchesByRef.get(branchRef);
  if (!branch) {
    throw new Error(`Branch "${branchRef}" not found in stack state.`);
  }
  return {
    branchRef: branch.ref,
    headSha: branch.headSha,
    baseSha: branch.baseSha,
    children: branch.childRefs.map((ref) => buildIntentNode(branchesByRef, ref)),
  };
}

async function readExistingEntries(path: string): Promise<Set<string>> {
  try {
    const entries = await readdir(path);
    return new Set(entries);
  } catch {
    return new Set();
  }
}
