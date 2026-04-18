import * as vscode from 'vscode';
import { ScmGitApiUtils, type ScmGitApi, type ScmGitRepository } from './scmGitApi';

const CONTEXT_KEY = 'teapot.scmHasChanges';

export class ScmChangesWatcher implements vscode.Disposable {
  private readonly repoDisposables = new Map<ScmGitRepository, vscode.Disposable>();
  private readonly apiDisposables: vscode.Disposable[] = [];
  private api: ScmGitApi | null = null;

  constructor(private readonly onDidChange?: () => void) {}

  async initialize(): Promise<void> {
    const api = await ScmGitApiUtils.getApi();
    if (!api) {
      return;
    }
    this.api = api;

    for (const repo of api.repositories) {
      this.attach(repo);
    }
    this.apiDisposables.push(
      api.onDidOpenRepository((repo) => {
        this.attach(repo);
        this.notifyChanged();
      }),
      api.onDidCloseRepository((repo) => {
        this.repoDisposables.get(repo)?.dispose();
        this.repoDisposables.delete(repo);
        this.notifyChanged();
      })
    );
    this.updateContext();
  }

  dispose(): void {
    for (const d of this.repoDisposables.values()) {
      d.dispose();
    }
    this.repoDisposables.clear();
    for (const d of this.apiDisposables) {
      d.dispose();
    }
    this.apiDisposables.length = 0;
  }

  private attach(repo: ScmGitRepository): void {
    const d = repo.state.onDidChange(() => this.notifyChanged());
    this.repoDisposables.set(repo, d);
  }

  private notifyChanged(): void {
    this.updateContext();
    this.onDidChange?.();
  }

  private updateContext(): void {
    const hasChanges =
      !!this.api &&
      this.api.repositories.some(
        (repo) => repo.state.indexChanges.length + repo.state.workingTreeChanges.length > 0
      );
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, hasChanges);
  }
}
