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
      pendingRebase: null,
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

  it('does not prioritize the current branch over newer sibling stacks', () => {
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
          commits: [{ sha: 'a1', message: 'A', author: 'dev', timeMs: 5, parentSha: 'm1' }],
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
          commits: [{ sha: 'z1', message: 'Z', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
        },
      ],
      trunk: 'main',
      current: 'zzz-feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    };

    const rows = layoutRows(state);
    const branchTips = rows.filter((row) => row.kind === 'commit' && row.isBranchTip);

    expect(branchTips[0]).toMatchObject({ branchName: 'aaa-feature' });
    expect(branchTips[1]).toMatchObject({ branchName: 'zzz-feature', isCurrent: true });
  });

  it(
    'anchors direct child branches at the matching trunk commit instead of hoisting them above trunk',
    () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm3',
          baseSha: 'm3',
          parentRef: null,
          childRefs: ['future-feature', 'legacy-feature'],
          ownedShas: ['m3', 'm2', 'm1'],
          commits: [
            { sha: 'm3', message: 'main tip', author: 'dev', timeMs: 3, parentSha: 'm2' },
            { sha: 'm2', message: 'main middle', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main base', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'future-feature',
          headSha: 'f1',
          baseSha: 'm3',
          parentRef: 'main',
          childRefs: [],
          ownedShas: ['f1'],
          commits: [{ sha: 'f1', message: 'future', author: 'dev', timeMs: 4, parentSha: 'm3' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'legacy-feature',
          headSha: 'l1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          ownedShas: ['l1'],
          commits: [{ sha: 'l1', message: 'legacy', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    };

    const rows = layoutRows(state);
    const futureFeatureIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'future-feature' && row.isBranchTip
    );
    const mainTipIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'main' && row.commit?.sha === 'm3'
    );
    const legacyFeatureIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'legacy-feature' && row.isBranchTip
    );
    const mainBaseIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'main' && row.commit?.sha === 'm1'
    );

    expect(futureFeatureIndex).toBeLessThan(mainTipIndex);
    expect(legacyFeatureIndex).toBeGreaterThan(mainTipIndex);
    expect(legacyFeatureIndex).toBeLessThan(mainBaseIndex);
    expect(
      rows.filter((row) => row.branchName === 'main' && row.kind === 'commit')
    ).toHaveLength(2);
    }
  );

  it('anchors nested child branches to the matching parent commit', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature'],
          ownedShas: ['m1'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
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
            { sha: 'f2', message: 'feature tip', author: 'dev', timeMs: 3, parentSha: 'f1' },
            { sha: 'f1', message: 'feature base', author: 'dev', timeMs: 2, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'fixup',
          headSha: 'x1',
          baseSha: 'f1',
          parentRef: 'feature',
          childRefs: [],
          ownedShas: ['x1'],
          commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 4, parentSha: 'f1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
        },
      ],
      trunk: 'main',
      current: 'fixup',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    };

    const rows = layoutRows(state);
    const featureTipIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.commit?.sha === 'f2'
    );
    const fixupIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'fixup' && row.isBranchTip
    );
    const featureBaseIndex = rows.findIndex(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.commit?.sha === 'f1'
    );

    expect(featureTipIndex).toBeLessThan(fixupIndex);
    expect(fixupIndex).toBeLessThan(featureBaseIndex);
  });

  it('places confirm and cancel actions on the first rebased branch row', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm2',
          baseSha: 'm2',
          parentRef: null,
          childRefs: ['feature'],
          ownedShas: ['m2', 'm1'],
          commits: [
            { sha: 'm2', message: 'main tip', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main base', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: true,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          ownedShas: ['f1'],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 3, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: {
        root: {
          branchRef: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          ownedShas: ['f1'],
          children: [],
        },
        targetBaseSha: 'm2',
        targetBranchRef: 'main',
      },
    };

    const rows = layoutRows(state);
    const targetRow = rows.find((row) => row.kind === 'commit' && row.commit?.sha === 'm2');
    const featureRow = rows.find((row) => row.kind === 'commit' && row.commit?.sha === 'f1');

    expect(targetRow).toMatchObject({ showsRebaseActions: false });
    expect(featureRow).toMatchObject({
      rebaseStatus: 'prompting',
      showsRebaseActions: true,
    });
  });
});
