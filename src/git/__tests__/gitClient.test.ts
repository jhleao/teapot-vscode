import { describe, expect, it } from 'vitest';
import { parseLocalBranchSnapshot, parseWorktreePorcelain } from '../gitClient';

describe('parseLocalBranchSnapshot', () => {
  it('parses branches and marks the current branch from for-each-ref output', () => {
    const stdout = ['*feature\tabc123', 'main\tdef456', 'fixup\t987654'].join('\n');

    expect(parseLocalBranchSnapshot(stdout)).toEqual({
      branches: [
        { name: 'feature', headSha: 'abc123' },
        { name: 'main', headSha: 'def456' },
        { name: 'fixup', headSha: '987654' },
      ],
      currentBranch: 'feature',
    });
  });

  it('returns a null current branch when no branch is marked current', () => {
    const stdout = ['main\tdef456', 'fixup\t987654'].join('\n');

    expect(parseLocalBranchSnapshot(stdout)).toEqual({
      branches: [
        { name: 'main', headSha: 'def456' },
        { name: 'fixup', headSha: '987654' },
      ],
      currentBranch: null,
    });
  });
});

describe('parseWorktreePorcelain', () => {
  it('parses main, linked, detached, and prunable worktree blocks', () => {
    const stdout = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt-feature',
      'HEAD bbbbbbb',
      'branch refs/heads/feature',
      '',
      'worktree /repo-wt-detached',
      'HEAD ccccccc',
      'detached',
      '',
      'worktree /repo-wt-stale',
      'HEAD ddddddd',
      'branch refs/heads/stale',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');

    expect(parseWorktreePorcelain(stdout)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo-wt-feature', branch: 'feature' },
      { path: '/repo-wt-detached', branch: null },
      { path: '/repo-wt-stale', branch: 'stale' },
    ]);
  });

  it('returns an empty list for empty output', () => {
    expect(parseWorktreePorcelain('')).toEqual([]);
  });

  it('skips blocks without a worktree line', () => {
    const stdout = ['HEAD aaaaaaa', 'branch refs/heads/orphan'].join('\n');
    expect(parseWorktreePorcelain(stdout)).toEqual([]);
  });
});
