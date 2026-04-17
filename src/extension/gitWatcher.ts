import * as vscode from 'vscode';

const REFRESH_DEBOUNCE_MS = 250;

interface GitRefsWatcherOptions {
  onRepoConfigChange?: () => void;
}

export class GitRefsWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    repoRoot: string,
    private readonly onChange: () => void,
    private readonly options: GitRefsWatcherOptions = {}
  ) {
    const patterns = ['.git/refs/heads/**', '.git/{HEAD,packed-refs}', '.git/worktrees/**'];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(repoRoot, pattern)
      );
      const scheduleRefresh = () => this.scheduleRefresh();

      watcher.onDidChange(scheduleRefresh, this, this.disposables);
      watcher.onDidCreate(scheduleRefresh, this, this.disposables);
      watcher.onDidDelete(scheduleRefresh, this, this.disposables);

      this.disposables.push(watcher);
    }

    const configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(repoRoot, '.git/config')
    );
    const scheduleConfigRefresh = () => {
      this.options.onRepoConfigChange?.();
      this.scheduleRefresh();
    };

    configWatcher.onDidChange(scheduleConfigRefresh, this, this.disposables);
    configWatcher.onDidCreate(scheduleConfigRefresh, this, this.disposables);
    configWatcher.onDidDelete(scheduleConfigRefresh, this, this.disposables);

    this.disposables.push(configWatcher);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    vscode.Disposable.from(...this.disposables).dispose();
    this.disposables.length = 0;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.onChange();
    }, REFRESH_DEBOUNCE_MS);
  }
}
