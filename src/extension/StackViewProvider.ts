import { mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { GitClient } from '../git/gitClient';
import { PeacockColorUtils } from '../git/peacockColor';
import { GitStackStateLoader } from '../git/stackState/loader';
import { WorktreeNamingUtils } from '../git/worktreeNaming';
import type { HostToWebviewMessage, RebaseIntent, StackState, WebviewToHostMessage } from '../protocol';
import { GitRebaseExecutor } from '../rebase/executor';
import { isRebaseIntentValid } from '../rebase/intent';
import { applyRebaseIntentToState } from '../rebase/project';
import { GitHubAuthUtils } from '../github/auth';
import { GitHubPrEnricher } from './githubPrEnricher';
import { GitRefsWatcher } from './gitWatcher';
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
  private readonly prEnricher = new GitHubPrEnricher();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === 'github') {
          void this.updateGitHubAuthContext();
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
      view.onDidDispose(() => {
        this.disposeViewState();
      })
    );

    this.attachGitWatcher();
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

  deleteWorktree(branchRef: string, worktreePath: string): void {
    this.enqueueOperation(() => this.performDeleteWorktree(branchRef, worktreePath));
  }

  createWorktree(branchRef: string): void {
    this.enqueueOperation(() => this.performCreateWorktree(branchRef));
  }

  signInToGitHub(): void {
    this.enqueueOperation(() => this.performSignInToGitHub());
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
      case 'ready':
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
      case 'checkoutBranch':
        await this.performCheckoutBranch(message.branchRef);
        return;
      case 'forcePushBranch':
        await this.performForcePushBranch(message.branchRef);
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
    });
    this.watchedRepoRoot = repoRoot;
  }

  private disposeViewState(): void {
    this.disposeGitWatcher();
    this.cachedStackState = null;
    this.cachedWorkspaceRoot = null;
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

    try {
      await GitRebaseExecutor.execute(workspaceRoot, intent);
      this.pendingRebase = null;
      await this.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(toErrorMessage(error));
      await this.refresh();
    }
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

    const savedSha = branch.headSha;
    await git.deleteBranch(branchRef);
    await this.refresh();

    const choice = await vscode.window.showInformationMessage(
      `Branch "${branchRef}" deleted`,
      'Undo'
    );
    if (choice === 'Undo') {
      this.enqueueOperation(async () => {
        const undoGit = await this.openGit();
        if (!undoGit) {
          return;
        }
        await undoGit.createBranchAt(branchRef, savedSha);
        await this.refresh();
      });
    }
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
    await this.updateGitHubAuthContext();
    if (!session) {
      return;
    }
    await this.refresh();
  }

  private async performForcePushBranch(branchRef: string): Promise<void> {
    const git = await this.openGit();
    if (!git) {
      return;
    }

    try {
      await git.forcePushBranch(branchRef);
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

  private async loadStackState(workspaceRoot: string | null): Promise<StackState> {
    if (!workspaceRoot) {
      this.cachedWorkspaceRoot = null;
      this.cachedStackState = {
        branches: [],
        trunk: null,
        current: null,
        repoRoot: null,
        error: 'No workspace folder open',
        pendingRebase: null,
      };
      return this.cachedStackState;
    }

    this.cachedWorkspaceRoot = workspaceRoot;
    const loaded = await GitStackStateLoader.load(workspaceRoot);
    this.cachedStackState = await this.enrichWithPullRequests(loaded, workspaceRoot);
    return this.cachedStackState;
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

      const workspaceRoot = this.getWorkspaceRoot();
      const state = await this.loadStackState(workspaceRoot);
      await this.presentState(state, workspaceRoot);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readExistingEntries(path: string): Promise<Set<string>> {
  try {
    const entries = await readdir(path);
    return new Set(entries);
  } catch {
    return new Set();
  }
}
