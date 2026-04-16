import './style.css';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../protocol';
import { StackInteractionController } from './controller/StackInteractionController';
import { ViewportScrollbar } from './controller/ViewportScrollbar';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
const viewport = document.getElementById('viewport');
const stack = document.getElementById('stack');
const scrollbar = document.getElementById('scrollbar');
const scrollbarThumb = document.getElementById('scrollbar-thumb');

if (!root || !viewport || !stack || !scrollbar || !scrollbarThumb) {
  throw new Error('Missing webview root containers');
}

const controller = new StackInteractionController(
  {
    viewportElement: viewport,
    contentElement: stack,
  },
  (message) => {
    vscode.postMessage(message);
  }
);
const viewportScrollbar = new ViewportScrollbar({
  rootElement: root,
  viewportElement: viewport,
  trackElement: scrollbar,
  thumbElement: scrollbarThumb,
});

const syncScrollbar = (): void => {
  viewportScrollbar.sync();
};

const resizeObserver = new ResizeObserver(() => {
  syncScrollbar();
});
resizeObserver.observe(viewport);
resizeObserver.observe(stack);

const renderAndSync = (message: HostToWebviewMessage): void => {
  controller.handleHostMessage(message);
  syncScrollbar();
};

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  renderAndSync(event.data);
});

stack.addEventListener('mousedown', (event) => {
  controller.handleMouseDown(event);
});

stack.addEventListener('click', (event) => {
  controller.handleClick(event);
});

viewport.addEventListener('scroll', () => {
  controller.handleScroll();
  syncScrollbar();
});

window.addEventListener('resize', () => {
  syncScrollbar();
});

window.addEventListener('mousemove', (event) => {
  controller.handleMouseMove(event);
});

window.addEventListener('mouseup', () => {
  controller.handleMouseUp();
  syncScrollbar();
});

window.addEventListener('blur', () => {
  controller.handleWindowBlur();
  syncScrollbar();
});

vscode.postMessage({ type: 'ready' });
