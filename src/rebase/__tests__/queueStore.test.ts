import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitClient } from '../../git/gitClient';
import type { OperationQueue } from '../../protocol';
import { OperationQueueStore, resolveGitDirFromRepoRoot } from '../queueStore';

describe('OperationQueueStore', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores queues under the real git directory for linked worktrees', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'teapot-vscode-queue-store-'));
    tempDirs.push(baseDir);
    const repoDir = join(baseDir, 'repo');
    const worktreeDir = join(baseDir, 'feature-wt');
    mkdirSync(repoDir);

    git(repoDir, ['init', '--quiet', '-b', 'main']);
    git(repoDir, ['config', 'user.name', 'Teapot Tests']);
    git(repoDir, ['config', 'user.email', 'teapot@example.com']);
    writeFileSync(join(repoDir, 'main.txt'), 'main\n');
    git(repoDir, ['add', 'main.txt']);
    git(repoDir, ['commit', '--quiet', '-m', 'main']);
    git(repoDir, ['branch', 'feature']);
    git(repoDir, ['worktree', 'add', '--quiet', worktreeDir, 'feature']);

    const gitClient = await GitClient.open(worktreeDir);
    if (!gitClient) {
      throw new Error('Expected git client for linked worktree');
    }

    const queue = createQueue(gitClient.getRepoRoot());
    const store = new OperationQueueStore(gitClient.getRepoRoot(), gitClient.getGitDir());

    await store.save(queue);

    expect(store.getPath()).toBe(
      join(gitClient.getGitDir(), 'teapot', 'operation-queue.json')
    );
    expect(existsSync(store.getPath())).toBe(true);
    await expect(store.load()).resolves.toEqual(queue);
  });

  it('resolves relative gitdir pointers from worktree .git files', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'teapot-vscode-queue-store-'));
    tempDirs.push(baseDir);
    const worktreeDir = join(baseDir, 'worktree');
    const gitDir = join(baseDir, 'repo', '.git', 'worktrees', 'worktree');
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(worktreeDir, '.git'), 'gitdir: ../repo/.git/worktrees/worktree\n');

    expect(resolveGitDirFromRepoRoot(worktreeDir)).toBe(gitDir);
  });
});

describe('GitClient worktree gitdir handling', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects active rebase state inside a linked worktree gitdir', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'teapot-vscode-git-client-'));
    tempDirs.push(baseDir);
    const repoDir = join(baseDir, 'repo');
    const worktreeDir = join(baseDir, 'feature-wt');
    mkdirSync(repoDir);

    git(repoDir, ['init', '--quiet', '-b', 'main']);
    git(repoDir, ['config', 'user.name', 'Teapot Tests']);
    git(repoDir, ['config', 'user.email', 'teapot@example.com']);
    writeFileSync(join(repoDir, 'main.txt'), 'main\n');
    git(repoDir, ['add', 'main.txt']);
    git(repoDir, ['commit', '--quiet', '-m', 'main']);
    git(repoDir, ['branch', 'feature']);
    git(repoDir, ['worktree', 'add', '--quiet', worktreeDir, 'feature']);

    const gitClient = await GitClient.open(worktreeDir);
    if (!gitClient) {
      throw new Error('Expected git client for linked worktree');
    }
    const rebaseMergeDir = join(gitClient.getGitDir(), 'rebase-merge');
    mkdirSync(rebaseMergeDir);
    writeFileSync(join(rebaseMergeDir, 'head-name'), 'refs/heads/feature\n');

    await expect(gitClient.hasActiveRebase()).resolves.toBe('merge');
    await expect(gitClient.hasPausedRebase()).resolves.toBeNull();

    writeFileSync(join(rebaseMergeDir, 'stopped-sha'), 'abc123\n');

    await expect(gitClient.hasPausedRebase()).resolves.toBe('merge');
    await expect(gitClient.readRebaseMergeHeadName()).resolves.toBe('feature');
  });
});

function createQueue(repoRoot: string): OperationQueue {
  return {
    schemaVersion: 1,
    createdAtMs: 123,
    repoRoot,
    originalBranchRef: 'main',
    steps: [],
    cursor: 0,
    completedHeads: {},
    label: 'test',
  };
}

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
}
