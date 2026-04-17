import * as vscode from 'vscode';

const GITHUB_PROVIDER_ID = 'github';
const SCOPES: readonly string[] = ['repo'];

export class GitHubAuthUtils {
  static getSilentSession(): Thenable<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession(GITHUB_PROVIDER_ID, [...SCOPES], {
      createIfNone: false,
    });
  }

  static promptForSession(): Thenable<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession(GITHUB_PROVIDER_ID, [...SCOPES], {
      createIfNone: true,
    });
  }
}
