import './style.css';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../protocol';
import { renderStackView } from './view/render';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root container');
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  if (event.data.type === 'stack') {
    renderStackView(root, event.data.state);
  }
});

vscode.postMessage({ type: 'ready' });
