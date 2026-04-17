import * as vscode from 'vscode';

export interface ScmGitChange {
  readonly uri: vscode.Uri;
}

export interface ScmGitInputBox {
  value: string;
}

export interface ScmGitRepositoryState {
  readonly indexChanges: ScmGitChange[];
  readonly workingTreeChanges: ScmGitChange[];
  readonly onDidChange: vscode.Event<void>;
}

export interface ScmGitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: ScmGitRepositoryState;
  readonly inputBox: ScmGitInputBox;
}

export interface ScmGitApi {
  readonly repositories: ScmGitRepository[];
  readonly onDidOpenRepository: vscode.Event<ScmGitRepository>;
  readonly onDidCloseRepository: vscode.Event<ScmGitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): ScmGitApi;
}

export class ScmGitApiUtils {
  static async getApi(): Promise<ScmGitApi | null> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) {
      return null;
    }
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      return ext.exports.getAPI(1);
    } catch {
      return null;
    }
  }

  static findRepository(api: ScmGitApi, repoRoot: string): ScmGitRepository | null {
    return api.repositories.find((repo) => repo.rootUri.fsPath === repoRoot) ?? null;
  }
}
