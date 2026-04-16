import * as vscode from 'vscode';
import { generateNonce } from './nonce';

export function renderStackWebviewHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview.js')
  );
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview.css'));
  const nonce = generateNonce();
  const cspSource = webview.cspSource;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Teapot Stack</title>
</head>
<body>
  <div id="root">
    <div id="viewport">
      <div id="stack"></div>
    </div>
    <div id="scrollbar" aria-hidden="true">
      <div id="scrollbar-thumb"></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
