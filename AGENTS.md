# teapot-vscode

VS Code extension port of the Teapot stack visualizer.

## Iterating on changes

After every code change, **build, repackage, and reinstall into VS Code** so the user can verify it:

```sh
npm run build && npm run package && code --install-extension teapot-vscode-0.0.9.vsix --force
```

Tests (`npx vitest run`) verify logic — they do not verify what VS Code actually renders. Never claim a UI-affecting change is done without reinstalling; the user has to reload the Teapot view to see the new build.
