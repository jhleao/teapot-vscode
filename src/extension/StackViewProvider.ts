import * as vscode from 'vscode';
import { GitStackBuilder } from '../git/stackBuilder';
import type { HostToWebviewMessage, StackState, WebviewToHostMessage } from '../protocol';
import { GitRefsWatcher } from './gitWatcher';
import { renderStackWebviewHtml } from './webviewHtml';

export class StackViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private gitWatcher: GitRefsWatcher | undefined;
  private watchedRepoRoot: string | null = null;

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
        if (message.type === 'ready' || message.type === 'refresh') {
          void this.refresh();
        }
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
    const state: StackState = workspaceRoot
      ? await GitStackBuilder.build(workspaceRoot)
      : {
          branches: [],
          trunk: null,
          current: null,
          repoRoot: null,
          error: 'No workspace folder open',
        };

    const message: HostToWebviewMessage = { type: 'stack', state };
    await this.view.webview.postMessage(message);

    const repoRoot = state.repoRoot ?? workspaceRoot;
    if (!repoRoot) {
      this.disposeGitWatcher();
      return;
    }

    if (repoRoot !== this.watchedRepoRoot) {
      this.attachGitWatcher(repoRoot);
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
    vscode.Disposable.from(...this.viewDisposables).dispose();
    this.viewDisposables.length = 0;
    this.view = undefined;
  }

  private disposeGitWatcher(): void {
    this.gitWatcher?.dispose();
    this.gitWatcher = undefined;
    this.watchedRepoRoot = null;
  }
}
