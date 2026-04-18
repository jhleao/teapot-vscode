import * as vscode from 'vscode';
import { ScmChangesWatcher } from './extension/scmChangesWatcher';
import { StackViewProvider } from './extension/StackViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new StackViewProvider(context);
  const scmWatcher = new ScmChangesWatcher(() => {
    void provider.refresh();
  });
  void scmWatcher.initialize();

  context.subscriptions.push(
    provider,
    scmWatcher,
    vscode.window.registerWebviewViewProvider('teapot.stackView', provider),
    vscode.commands.registerCommand('teapot.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('teapot.createWorkingCommit', () => {
      provider.createWorkingCommit();
    }),
    vscode.commands.registerCommand('teapot.branchAndCommit', () => {
      provider.branchAndCommit();
    }),
    vscode.commands.registerCommand('teapot.amendAndRebase', () => {
      provider.amendAndRebase();
    }),
    vscode.commands.registerCommand('teapot.pullTrunk', () => {
      provider.pullTrunk();
    }),
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
      'teapot.createBranchAtCommit',
      (ctx: { commitSha: string }) => {
        provider.createBranchAtCommit(ctx.commitSha);
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
    vscode.commands.registerCommand('teapot.gitHubStatusLoading', () => {
      void provider.refresh();
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
