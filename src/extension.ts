import * as vscode from 'vscode';
import { StackViewProvider } from './extension/StackViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new StackViewProvider(context);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider('teapot.stackView', provider),
    vscode.commands.registerCommand('teapot.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('teapot.copyBranchName', (ctx: { branchRef: string }) => {
      provider.copyBranchName(ctx.branchRef);
    }),
    vscode.commands.registerCommand('teapot.checkoutBranch', (ctx: { branchRef: string }) => {
      provider.checkoutBranch(ctx.branchRef);
    }),
    vscode.commands.registerCommand('teapot.renameBranch', (ctx: { branchRef: string }) => {
      provider.renameBranch(ctx.branchRef);
    }),
    vscode.commands.registerCommand('teapot.deleteBranch', (ctx: { branchRef: string }) => {
      provider.deleteBranch(ctx.branchRef);
    }),
    vscode.commands.registerCommand(
      'teapot.amendCommitMessage',
      (ctx: { commitSha: string; currentMessage: string }) => {
        provider.amendCommitMessage(ctx.commitSha, ctx.currentMessage);
      }
    ),
    vscode.commands.registerCommand(
      'teapot.deleteWorktree',
      (ctx: { branchRef: string; worktreePath: string }) => {
        provider.deleteWorktree(ctx.branchRef, ctx.worktreePath);
      }
    ),
    vscode.commands.registerCommand('teapot.createWorktree', (ctx: { branchRef: string }) => {
      provider.createWorktree(ctx.branchRef);
    }),
    vscode.commands.registerCommand('teapot.createPullRequest', (ctx: { branchRef: string }) => {
      provider.createPullRequest(ctx.branchRef);
    }),
    vscode.commands.registerCommand('teapot.signInToGitHub', () => {
      provider.signInToGitHub();
    }),
    vscode.commands.registerCommand('teapot.gitHubStatus', () => {
      provider.signInToGitHub();
    }),
    vscode.commands.registerCommand('teapot.gitHubStatusUnauthenticated', () => {
      provider.signInToGitHub();
    }),
    vscode.commands.registerCommand(
      'teapot.openWorktreeInNewWindow',
      async (ctx: { worktreePath: string }) => {
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(ctx.worktreePath),
          { forceNewWindow: true }
        );
      }
    )
  );
}

export function deactivate(): void {}
