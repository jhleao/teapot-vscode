# Teapot for VSCode

Stacked branches visualizer that lives in the VSCode sidebar and renders your local branches as a stack tree, styled to feel native alongside VSCode's built-in Source Control Graph.

This is a from-scratch rewrite of [Teapot](https://github.com/jhleao/teapot) (Electron app) as a VSCode extension.

## MVP scope

- Visualization of local branches as a stack tree
- Drag-and-drop rebase intent preview with confirm/cancel on the target base row
- Native-feeling drop indicator and auto-scroll during drag
- Native rendering using VSCode theme CSS variables + codicons
- Auto-refresh on git state changes
- Command: `Teapot: Refresh`

Still out of scope for this extension MVP: working tree / staging, GitHub integration, context menus, and the broader Teapot workflow surface beyond stack visualization plus rebase-intent driven rebases.

## Develop

```bash
npm install
npm run verify
# Install locally:
npm run package
code --install-extension teapot-vscode-*.vsix
```
