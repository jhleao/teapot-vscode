# Teapot for VSCode

Stacked branches visualizer — a read-only MVP that lives in the VSCode sidebar and renders your local branches as a stack tree, styled to feel native alongside VSCode's built-in Source Control Graph.

This is a from-scratch rewrite of [Teapot](https://github.com/jhleao/teapot) (Electron app) as a VSCode extension.

## MVP scope

- Read-only visualization of local branches as a stack tree
- Native rendering using VSCode theme CSS variables + codicons
- Auto-refresh on git state changes
- Command: `Teapot: Refresh`

Out of scope for MVP: working tree / staging, GitHub integration, context menus, drag-and-drop, any writes.

## Develop

```bash
npm install
npm run build
# Install locally:
npm run package
code --install-extension teapot-vscode-*.vsix
```
