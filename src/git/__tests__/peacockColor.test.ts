import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PeacockColorUtils } from '../peacockColor';

describe('PeacockColorUtils.readForWorktree', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function setupWorktree(settingsContent: string | null): string {
    const worktree = mkdtempSync(join(tmpdir(), 'teapot-vscode-peacock-'));
    createdDirs.push(worktree);
    if (settingsContent !== null) {
      mkdirSync(join(worktree, '.vscode'));
      writeFileSync(join(worktree, '.vscode', 'settings.json'), settingsContent);
    }
    return worktree;
  }

  it('returns null when no settings.json exists', async () => {
    const worktree = setupWorktree(null);
    await expect(PeacockColorUtils.readForWorktree(worktree)).resolves.toBeNull();
  });

  it('reads peacock.color from plain JSON', async () => {
    const worktree = setupWorktree('{ "peacock.color": "#88bb22" }');
    await expect(PeacockColorUtils.readForWorktree(worktree)).resolves.toBe('#88bb22');
  });

  it('tolerates JSONC with // line comments, block comments, and trailing commas', async () => {
    const worktree = setupWorktree(`{
      // Peacock color picker
      "peacock.color": "#ff6600", /* locked in 2026-01 */
      "editor.fontSize": 14,
    }`);
    await expect(PeacockColorUtils.readForWorktree(worktree)).resolves.toBe('#ff6600');
  });

  it('falls back to peacock.remoteColor when peacock.color is absent', async () => {
    const worktree = setupWorktree('{ "peacock.remoteColor": "#007fff" }');
    await expect(PeacockColorUtils.readForWorktree(worktree)).resolves.toBe('#007fff');
  });

  it('returns null when settings.json is malformed beyond JSONC', async () => {
    const worktree = setupWorktree('{ not valid at all ');
    await expect(PeacockColorUtils.readForWorktree(worktree)).resolves.toBeNull();
  });

  it('does not mistake a // inside a string value for a comment', async () => {
    const worktree = setupWorktree(
      '{ "peacock.color": "#123456", "note": "see http://example.com" }'
    );
    await expect(PeacockColorUtils.readForWorktree(worktree)).resolves.toBe('#123456');
  });
});
