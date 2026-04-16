import * as vscode from 'vscode';
import { StackViewProvider } from './extension/StackViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new StackViewProvider(context);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider('teapot.stackView', provider),
    vscode.commands.registerCommand('teapot.refresh', () => provider.refresh())
  );
}

export function deactivate(): void {}
