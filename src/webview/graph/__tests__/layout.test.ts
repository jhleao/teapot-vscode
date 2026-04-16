import { describe, expect, it } from 'vitest';
import type { StackState } from '../../../protocol';
import { layoutRows } from '../layout';

describe('layoutRows', () => {
  it('renders the current branch subtree above its parent stack', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature'],
          ownedShas: ['m1'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 0, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'feature',
          headSha: 'f2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['fixup'],
          ownedShas: ['f2', 'f1'],
          commits: [
            { sha: 'f2', message: 'feature tip', author: 'dev', timeMs: 0, parentSha: 'f1' },
            { sha: 'f1', message: 'feature base', author: 'dev', timeMs: 0, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'fixup',
          headSha: 'x1',
          baseSha: 'f2',
          parentRef: 'feature',
          childRefs: [],
          ownedShas: ['x1'],
          commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 0, parentSha: 'f2' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
        },
      ],
      trunk: 'main',
      current: 'fixup',
      repoRoot: '/repo',
      error: null,
    };

    const rows = layoutRows(state);

    expect(rows.map((row) => row.branchName)).toEqual([
      'fixup',
      'feature',
      'feature',
      'feature',
      'main',
    ]);
    expect(rows[0]).toMatchObject({ kind: 'commit', branchName: 'fixup', isCurrent: true });
    expect(rows[3]).toMatchObject({ kind: 'branch-header', branchName: 'feature', parentLane: 0 });
  });

  it('sorts the branch containing the current ref ahead of sibling branches', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['zzz-feature', 'aaa-feature'],
          ownedShas: ['m1'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 0, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'aaa-feature',
          headSha: 'a1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          ownedShas: ['a1'],
          commits: [{ sha: 'a1', message: 'A', author: 'dev', timeMs: 0, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'zzz-feature',
          headSha: 'z1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          ownedShas: ['z1'],
          commits: [{ sha: 'z1', message: 'Z', author: 'dev', timeMs: 0, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
        },
      ],
      trunk: 'main',
      current: 'zzz-feature',
      repoRoot: '/repo',
      error: null,
    };

    const rows = layoutRows(state);
    const branchTips = rows.filter((row) => row.kind === 'commit' && row.isBranchTip);

    expect(branchTips[0]).toMatchObject({ branchName: 'zzz-feature', isCurrent: true });
    expect(branchTips[1]).toMatchObject({ branchName: 'aaa-feature' });
  });
});
