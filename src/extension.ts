import * as vscode from 'vscode';
import * as path from 'node:path';
import { GitUtils } from './git';
import type { HostToWebview, StackState, WebviewToHost } from './types';

export function activate(context: vscode.ExtensionContext) {
  const provider = new StackViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('teapot.stackView', provider),
    vscode.commands.registerCommand('teapot.refresh', () => provider.refresh())
  );
}

export function deactivate() {}

class StackViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private debounceHandle: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')],
    };

    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === 'ready' || msg.type === 'refresh') {
        this.refresh();
      }
    });

    this.setupFileWatcher();

    view.onDidDispose(() => {
      this.teardown();
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const cwd = this.resolveCwd();
    const state: StackState = cwd
      ? await GitUtils.buildStack(cwd)
      : { branches: [], trunk: null, current: null, repoRoot: null, error: 'No workspace folder open' };
    const msg: HostToWebview = { type: 'stack', state };
    this.view.webview.postMessage(msg);
  }

  private resolveCwd(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return folders[0].uri.fsPath;
  }

  private setupFileWatcher() {
    const cwd = this.resolveCwd();
    if (!cwd) return;
    const gitDir = path.join(cwd, '.git');

    const refWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(cwd, '.git/refs/heads/**')
    );
    const headWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(cwd, '.git/{HEAD,packed-refs}')
    );

    const onChange = () => {
      if (this.debounceHandle) clearTimeout(this.debounceHandle);
      this.debounceHandle = setTimeout(() => this.refresh(), 250);
    };

    for (const w of [refWatcher, headWatcher]) {
      w.onDidChange(onChange);
      w.onDidCreate(onChange);
      w.onDidDelete(onChange);
      this.disposables.push(w);
    }
    void gitDir;
  }

  private teardown() {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.view = undefined;
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.css')
    );
    const nonce = generateNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Teapot Stack</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
