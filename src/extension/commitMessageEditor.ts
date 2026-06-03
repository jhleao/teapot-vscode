import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';

const INSTRUCTIONS = [
  '# Please enter the commit message for your changes. The first line is the',
  '# subject; leave a blank line before the body. Lines starting with "#" are',
  '# ignored. Save (Cmd/Ctrl+S) to amend, or close without saving to cancel.',
];

/**
 * Opens the given commit message in a real editor tab so the user can edit a
 * full subject + body, mirroring `git commit --amend`'s editor flow. Saving the
 * document confirms the amend; closing without saving cancels.
 *
 * Returns the cleaned message (comment lines stripped, trimmed), or `undefined`
 * if the user cancelled or left the message empty.
 */
export async function editCommitMessage(initialMessage: string): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'teapot-amend-'));
  const filePath = join(dir, 'TEAPOT_EDITMSG');
  const initial = initialMessage.replace(/\n+$/, '');
  await writeFile(filePath, `${initial}\n\n${INSTRUCTIONS.join('\n')}\n`, 'utf8');

  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, 'git-commit');
  await vscode.window.showTextDocument(doc, { preview: false });
  // Put the cursor at the very start so the user types over the subject.
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.fsPath === uri.fsPath) {
    editor.selection = new vscode.Selection(0, 0, 0, 0);
  }

  try {
    const text = await waitForSaveOrClose(uri);
    if (text === undefined) {
      return undefined;
    }
    const message = stripComments(text);
    return message === '' ? undefined : message;
  } finally {
    await closeTabForUri(uri);
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Resolves with the document text when it is first saved, or `undefined` when
 * it is closed without saving. (If the user picks "Save" in the close dialog,
 * the save event fires first and wins, so an edited-then-closed message is kept.)
 */
function waitForSaveOrClose(uri: vscode.Uri): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const disposables: vscode.Disposable[] = [];
    const settle = (value: string | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      disposables.forEach((d) => d.dispose());
      resolve(value);
    };

    disposables.push(
      vscode.workspace.onDidSaveTextDocument((savedDoc) => {
        if (savedDoc.uri.fsPath === uri.fsPath) {
          settle(savedDoc.getText());
        }
      }),
      vscode.workspace.onDidCloseTextDocument((closedDoc) => {
        if (closedDoc.uri.fsPath === uri.fsPath) {
          settle(undefined);
        }
      })
    );
  });
}

function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

async function closeTabForUri(uri: vscode.Uri): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === uri.fsPath) {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }
}
