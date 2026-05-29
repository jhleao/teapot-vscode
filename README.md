# Teapot for VSCode

Rewrite of [Teapot](https://github.com/jhleao/teapot) as a VSCode extension.

```bash
npm install
npm run verify
# Install locally:
npm run package
code --install-extension teapot-vscode-*.vsix
```

## Agent attention hooks

Teapot can show an attention marker on a worktree when a local coding agent is
waiting for input or has just finished a turn. The marker is driven by small
JSON files written under the repository's shared git directory:

```text
<git-common-dir>/teapot/agents/*.json
```

This repository includes project hook config for Claude (`.claude/settings.json`)
and Codex (`.codex/hooks.json`). Both call `scripts/teapot-agent-attention.sh`,
which writes or clears the attention file for the current worktree.

If your agent does not load project hook config automatically, copy the matching
hook block into your user-level settings and keep the command pointed at this
repository's `scripts/teapot-agent-attention.sh`.
