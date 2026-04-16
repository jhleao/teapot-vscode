import * as vscode from 'vscode';
import { GitStackBuilder } from '../git/stackBuilder';
import type { HostToWebviewMessage, RebaseIntent, StackState, WebviewToHostMessage } from '../protocol';
import { GitRebaseExecutor } from '../rebase/executor';
import { isRebaseIntentValid } from '../rebase/intent';
import { applyRebaseIntentToState } from '../rebase/project';
import { GitRefsWatcher } from './gitWatcher';
import { renderStackWebviewHtml } from './webviewHtml';

export class StackViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private gitWatcher: GitRefsWatcher | undefined;
  private watchedRepoRoot: string | null = null;
  private cachedStackState: StackState | null = null;
  private pendingRebase: RebaseIntent | null = null;
  private webviewMessageChain: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      })
    );
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
        this.enqueueWebviewMessage(message);
      }),
      view.onDidDispose(() => {
        this.disposeViewState();
      })
    );

    this.attachGitWatcher();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    const state = await this.loadStackState(workspaceRoot);
    await this.presentState(state, workspaceRoot);
  }

  dispose(): void {
    this.disposeViewState();
    vscode.Disposable.from(...this.disposables).dispose();
    this.disposables.length = 0;
  }

  private getWorkspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private enqueueWebviewMessage(message: WebviewToHostMessage): void {
    this.webviewMessageChain = this.webviewMessageChain
      .catch(() => undefined)
      .then(() => this.handleWebviewMessage(message))
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
    this.pendingRebase = null;
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

  private async loadStackState(workspaceRoot: string | null): Promise<StackState> {
    if (!workspaceRoot) {
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

    this.cachedStackState = await GitStackBuilder.build(workspaceRoot);
    return this.cachedStackState;
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
    if (!workspaceRoot || !this.cachedStackState) {
      return null;
    }

    return this.cachedStackState.repoRoot === workspaceRoot || this.cachedStackState.repoRoot == null
      ? this.cachedStackState
      : null;
  }

  private async getStateForUiInteraction(workspaceRoot: string | null): Promise<StackState> {
    if (!workspaceRoot) {
      return this.loadStackState(workspaceRoot);
    }

    return this.getCachedStackState(workspaceRoot) ?? this.loadStackState(workspaceRoot);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
