import { describe, expect, it } from 'vitest';
import type { RebaseIntent, StackState } from '../../protocol';
import { createRebaseIntent } from '../intent';
import { applyRebaseIntentToState } from '../project';

describe('rebase intent helpers', () => {
  it('builds an intent for a branch and includes its descendants', () => {
    const state = createState();

    const intent = createRebaseIntent(state, 'feature', 'm3');

    expect(intent).toMatchObject({
      root: {
        branchRef: 'feature',
        headSha: 'f2',
        baseSha: 'm1',
      },
      targetBaseSha: 'm3',
      targetBranchRef: 'main',
    });
    expect(intent?.root.children.map((child) => child.branchRef)).toEqual(['fixup']);
  });

  it('rejects drops onto the dragged subtree', () => {
    const state = createState();

    expect(createRebaseIntent(state, 'feature', 'f1')).toBeNull();
    expect(createRebaseIntent(state, 'feature', 'x1')).toBeNull();
  });

  it('rejects branches with no owned commits', () => {
    const state = createState();
    state.branches.push({
      ref: 'alias',
      headSha: 'f2',
      baseSha: 'f2',
      parentRef: 'feature',
      childRefs: [],
      ownedShas: [],
      commits: [],
      isTrunk: false,
      isRemote: false,
      isCurrent: false,
      worktreePath: null,
          worktreePeacockColor: null,
    });

    expect(createRebaseIntent(state, 'alias', 'm3')).toBeNull();
  });

  it('projects the moved branch under the new parent while preserving descendants', () => {
    const state = createState();
    const intent = createRebaseIntent(state, 'feature', 'm3') as RebaseIntent;

    const projected = applyRebaseIntentToState(state, intent);
    const branchesByRef = new Map(projected.branches.map((branch) => [branch.ref, branch]));

    expect(branchesByRef.get('feature')).toMatchObject({
      parentRef: 'main',
      baseSha: 'm3',
      childRefs: ['fixup'],
    });
    expect(branchesByRef.get('fixup')?.parentRef).toBe('feature');
    expect(projected.pendingRebase?.targetBaseSha).toBe('m3');
  });
});

function createState(): StackState {
  return {
    branches: [
      {
        ref: 'main',
        headSha: 'm3',
        baseSha: 'm3',
        parentRef: null,
        childRefs: ['feature'],
        ownedShas: ['m3', 'm2', 'm1'],
        commits: [
          { sha: 'm3', message: 'main 3', author: 'dev', timeMs: 3, parentSha: 'm2' },
          { sha: 'm2', message: 'main 2', author: 'dev', timeMs: 2, parentSha: 'm1' },
          { sha: 'm1', message: 'main 1', author: 'dev', timeMs: 1, parentSha: '' },
        ],
        isTrunk: true,
        isRemote: false,
        isCurrent: true,
        worktreePath: null,
          worktreePeacockColor: null,
      },
      {
        ref: 'feature',
        headSha: 'f2',
        baseSha: 'm1',
        parentRef: 'main',
        childRefs: ['fixup'],
        ownedShas: ['f2', 'f1'],
        commits: [
          { sha: 'f2', message: 'feature 2', author: 'dev', timeMs: 5, parentSha: 'f1' },
          { sha: 'f1', message: 'feature 1', author: 'dev', timeMs: 4, parentSha: 'm1' },
        ],
        isTrunk: false,
        isRemote: false,
        isCurrent: false,
        worktreePath: null,
          worktreePeacockColor: null,
      },
      {
        ref: 'fixup',
        headSha: 'x1',
        baseSha: 'f1',
        parentRef: 'feature',
        childRefs: [],
        ownedShas: ['x1'],
        commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 6, parentSha: 'f1' }],
        isTrunk: false,
        isRemote: false,
        isCurrent: false,
        worktreePath: null,
          worktreePeacockColor: null,
      },
    ],
    trunk: 'main',
    current: 'main',
    repoRoot: '/repo',
    error: null,
    pendingRebase: null,
  };
}
