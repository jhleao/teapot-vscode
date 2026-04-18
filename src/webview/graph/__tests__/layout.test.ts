import { describe, expect, it } from 'vitest';
import type { PullRequestInfo, RebaseIntent, StackState } from '../../../protocol';
import { layoutRows } from '../layout';
import { applyRebaseIntentToState } from '../../../rebase/project';

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
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 0, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['fixup'],
          commits: [
            { sha: 'f2', message: 'feature tip', author: 'dev', timeMs: 0, parentSha: 'f1' },
            { sha: 'f1', message: 'feature base', author: 'dev', timeMs: 0, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'fixup',
          headSha: 'x1',
          baseSha: 'f2',
          parentRef: 'feature',
          childRefs: [],
          commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 0, parentSha: 'f2' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'fixup',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
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

  it('drops shared branchless ancestor commits from non-primary siblings so the branchless commit renders once', () => {
    // Two sibling branches both own [tip, shared-test1] where test1 is a
    // branchless ancestor. In the original Teapot visual, test1 shows up
    // exactly once on the primary's spine; the non-primary peels off at test1.
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['branch2', 'lobster'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'branch2',
          headSha: 'test2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'test2', message: 'chore: test2', author: 'dev', timeMs: 36, parentSha: 'test1' },
            { sha: 'test1', message: 'chore: test1', author: 'dev', timeMs: 37, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'lobster',
          headSha: 'test5',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'test5', message: 'chore: test5', author: 'dev', timeMs: 33, parentSha: 'test1' },
            { sha: 'test1', message: 'chore: test1', author: 'dev', timeMs: 37, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const test1Rows = rows.filter(
      (row) => row.kind === 'commit' && row.commit?.sha === 'test1'
    );

    // The branchless test1 commit should render exactly once.
    expect(test1Rows).toHaveLength(1);

    // It should render on the primary sibling's spine at lane 1, not under
    // the spin-off.
    expect(test1Rows[0]).toMatchObject({ lane: 1 });

    // Both siblings' tip commits should appear; the spin-off at lane 2.
    const test2Row = rows.find(
      (row) => row.kind === 'commit' && row.commit?.sha === 'test2'
    );
    const test5Row = rows.find(
      (row) => row.kind === 'commit' && row.commit?.sha === 'test5'
    );
    expect(test2Row).toBeDefined();
    expect(test5Row).toBeDefined();
    // Exactly one of them is the spin-off (lane 2); the other stays on the
    // primary's spine (lane 1).
    const spinoffLanes = [test2Row!.lane, test5Row!.lane].sort();
    expect(spinoffLanes).toEqual([1, 2]);
  });

  it('keeps independent siblings as lane-1 peers when they share no ancestor commits', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['branch1', 'branch2', 'lobster'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'branch1',
          headSha: 'b1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'b1', message: 'test1', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'branch2',
          headSha: 'b2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'b2', message: 'test2', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'lobster',
          headSha: 'l1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'l1', message: 'test5', author: 'dev', timeMs: 10, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);

    // No siblings share ancestor commits, so none reattach as spin-offs.
    // All three render as independent peers off trunk at lane 1, each with
    // its own branch-header curve back to lane 0.
    const tipByBranch = Object.fromEntries(
      rows
        .filter((row) => row.kind === 'commit' && row.isBranchTip)
        .map((row) => [row.branchName, row])
    );

    expect(tipByBranch['branch1']?.lane).toBe(1);
    expect(tipByBranch['branch2']?.lane).toBe(1);
    expect(tipByBranch['lobster']?.lane).toBe(1);

    const branchHeaders = rows.filter((row) => row.kind === 'branch-header');
    const headerByBranch = Object.fromEntries(
      branchHeaders.map((row) => [row.branchName, row])
    );

    expect(headerByBranch['branch1']).toMatchObject({ lane: 1, parentLane: 0 });
    expect(headerByBranch['branch2']).toMatchObject({ lane: 1, parentLane: 0 });
    expect(headerByBranch['lobster']).toMatchObject({ lane: 1, parentLane: 0 });
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
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 0, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'aaa-feature',
          headSha: 'a1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'a1', message: 'A', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'zzz-feature',
          headSha: 'z1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'z1', message: 'Z', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'zzz-feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
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
          commits: [
            { sha: 'm3', message: 'main tip', author: 'dev', timeMs: 3, parentSha: 'm2' },
            { sha: 'm2', message: 'main middle', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main base', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'future-feature',
          headSha: 'f1',
          baseSha: 'm3',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'future', author: 'dev', timeMs: 4, parentSha: 'm3' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'legacy-feature',
          headSha: 'l1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'l1', message: 'legacy', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
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
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['fixup'],
          commits: [
            { sha: 'f2', message: 'feature tip', author: 'dev', timeMs: 3, parentSha: 'f1' },
            { sha: 'f1', message: 'feature base', author: 'dev', timeMs: 2, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'fixup',
          headSha: 'x1',
          baseSha: 'f1',
          parentRef: 'feature',
          childRefs: [],
          commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 4, parentSha: 'f1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'fixup',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
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
          commits: [
            { sha: 'm2', message: 'main tip', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main base', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 3, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
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
          children: [],
        },
        targetBaseSha: 'm2',
        targetBranchRef: 'main',
      },
      activeRebase: null,
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

  it('flags trunk rows with isTrunkBranch and non-trunk rows without it', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const mainRow = rows.find((row) => row.kind === 'commit' && row.branchName === 'main');
    const featureRow = rows.find((row) => row.kind === 'commit' && row.branchName === 'feature');

    expect(mainRow).toMatchObject({ isTrunkBranch: true });
    expect(featureRow).toMatchObject({ isTrunkBranch: false, isCurrent: true });
  });

  it('exposes pullRequest only on the branch tip row and leaves other rows null', () => {
    const pullRequest: PullRequestInfo = {
      number: 7,
      url: 'https://github.com/a/b/pull/7',
      state: 'open',
      isInSync: true,
    };

    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'f2', message: 'tip', author: 'dev', timeMs: 3, parentSha: 'f1' },
            { sha: 'f1', message: 'base', author: 'dev', timeMs: 2, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest,
        },
      ],
      trunk: 'main',
      current: 'feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const featureTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.isBranchTip
    );
    const featureBase = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && !row.isBranchTip
    );
    const branchHeader = rows.find((row) => row.kind === 'branch-header');
    const mainRow = rows.find((row) => row.kind === 'commit' && row.branchName === 'main');

    expect(featureTip?.pullRequest).toEqual(pullRequest);
    expect(featureBase?.pullRequest).toBeNull();
    expect(branchHeader?.pullRequest).toBeNull();
    expect(mainRow?.pullRequest).toBeNull();
  });

  it('collapses sibling local branches at the same headSha into a single tip row', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature', 'feature-wip'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature-wip',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const tipRows = rows.filter(
      (row) =>
        row.kind === 'commit' &&
        row.isBranchTip &&
        (row.branchName === 'feature' || row.branchName === 'feature-wip')
    );

    expect(tipRows).toHaveLength(1);
    expect(tipRows[0].branchName).toBe('feature');
    expect(tipRows[0].additionalBranchRefs).toEqual(['feature-wip']);
  });

  it('promotes the current branch to primary when it shares a SHA with siblings', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['aaa-feature', 'zzz-feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'aaa-feature',
          headSha: 's1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 's1', message: 'shared', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'zzz-feature',
          headSha: 's1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 's1', message: 'shared', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'zzz-feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const tipRows = rows.filter(
      (row) =>
        row.kind === 'commit' &&
        row.isBranchTip &&
        (row.branchName === 'aaa-feature' || row.branchName === 'zzz-feature')
    );

    expect(tipRows).toHaveLength(1);
    expect(tipRows[0].branchName).toBe('zzz-feature');
    expect(tipRows[0].isCurrent).toBe(true);
    expect(tipRows[0].additionalBranchRefs).toEqual(['aaa-feature']);
  });

  it('keeps remote siblings as their own rows even when sharing a SHA with locals', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature', 'feature-wip', 'origin/feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature-wip',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'origin/feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 5, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: true,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const tipRows = rows.filter((row) => row.kind === 'commit' && row.isBranchTip);

    const localPrimary = tipRows.find((row) => row.branchName === 'feature');
    const remoteRow = tipRows.find((row) => row.branchName === 'origin/feature');
    const featureWipRow = tipRows.find((row) => row.branchName === 'feature-wip');

    expect(localPrimary?.additionalBranchRefs).toEqual(['feature-wip']);
    expect(remoteRow).toBeDefined();
    expect(remoteRow?.additionalBranchRefs).toEqual([]);
    expect(featureWipRow).toBeUndefined();
  });

  it('folds an empty child branch into its parent trunk row when they share a SHA', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['chore/cleanup'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'chore/cleanup',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const choreRow = rows.find((row) => row.branchName === 'chore/cleanup');
    const mainRow = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'main' && row.commit?.sha === 'm1'
    );

    expect(choreRow).toBeUndefined();
    expect(mainRow?.additionalBranchRefs).toEqual(['chore/cleanup']);
  });

  it('keeps the rebased branch visible after optimistically rebasing a single branch onto trunk head', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm3',
          baseSha: 'm3',
          parentRef: null,
          childRefs: ['feature'],
          commits: [
            { sha: 'm3', message: 'main tip', author: 'dev', timeMs: 3, parentSha: 'm2' },
            { sha: 'm2', message: 'main middle', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main base', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 4, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const intent: RebaseIntent = {
      root: {
        branchRef: 'feature',
        headSha: 'f1',
        baseSha: 'm1',
        children: [],
      },
      targetBaseSha: 'm3',
      targetBranchRef: 'main',
    };

    const projected = applyRebaseIntentToState(state, intent);
    const rows = layoutRows(projected);

    const featureTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.isBranchTip
    );
    expect(featureTip).toBeDefined();
    expect(featureTip?.commit?.sha).toBe('f1');
  });

  it('keeps the dragged branch visible after optimistically rebasing onto trunk head even when trunk shares its SHA with a collapsed sibling', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['chore/alias', 'feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        // Zero-commit sibling branch sitting on trunk's head; gets collapsed
        // into main's row by planSameShaCollapse.
        {
          ref: 'chore/alias',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'f-base',
          parentRef: 'other',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 2, parentSha: '' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'other',
          headSha: 'f-base',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['feature'],
          commits: [{ sha: 'f-base', message: 'other', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const intent: RebaseIntent = {
      root: {
        branchRef: 'feature',
        headSha: 'f1',
        baseSha: 'f-base',
        children: [],
      },
      targetBaseSha: 'm1',
      targetBranchRef: 'main',
    };

    const projected = applyRebaseIntentToState(state, intent);
    const rows = layoutRows(projected);

    const featureTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.isBranchTip
    );
    expect(featureTip).toBeDefined();
    expect(featureTip?.commit?.sha).toBe('f1');
  });

  it('still emits descendants when a branch gets optimistically reparented under a collapsed sibling of trunk', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['chore/alias', 'feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'chore/alias',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'f-base',
          parentRef: 'other',
          childRefs: [],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 2, parentSha: '' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'other',
          headSha: 'f-base',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['feature'],
          commits: [{ sha: 'f-base', message: 'other', author: 'dev', timeMs: 2, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    // Simulate the buggy pre-fix intent that targets the collapsed sibling
    // instead of trunk. Even with this malformed intent, the layout should
    // still render the dragged branch by routing it through the primary.
    const intent: RebaseIntent = {
      root: {
        branchRef: 'feature',
        headSha: 'f1',
        baseSha: 'f-base',
        children: [],
      },
      targetBaseSha: 'm1',
      targetBranchRef: 'chore/alias',
    };

    const projected = applyRebaseIntentToState(state, intent);
    const rows = layoutRows(projected);

    const featureTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.isBranchTip
    );
    expect(featureTip).toBeDefined();
  });

  it('keeps a stacked branch subtree visible after optimistically rebasing onto trunk head', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm3',
          baseSha: 'm3',
          parentRef: null,
          childRefs: ['feature'],
          commits: [
            { sha: 'm3', message: 'main tip', author: 'dev', timeMs: 3, parentSha: 'm2' },
            { sha: 'm2', message: 'main middle', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main base', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['fixup'],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 4, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'fixup',
          headSha: 'x1',
          baseSha: 'f1',
          parentRef: 'feature',
          childRefs: [],
          commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 5, parentSha: 'f1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'fixup',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const intent: RebaseIntent = {
      root: {
        branchRef: 'feature',
        headSha: 'f1',
        baseSha: 'm1',
        children: [
          {
            branchRef: 'fixup',
            headSha: 'x1',
            baseSha: 'f1',
            children: [],
          },
        ],
      },
      targetBaseSha: 'm3',
      targetBranchRef: 'main',
    };

    const projected = applyRebaseIntentToState(state, intent);
    const rows = layoutRows(projected);

    const featureTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'feature' && row.isBranchTip
    );
    const fixupTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'fixup' && row.isBranchTip
    );

    expect(featureTip).toBeDefined();
    expect(fixupTip).toBeDefined();
  });

  it('marks non-tip non-trunk commits with canCreateBranchAtCommit', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['feature'],
          commits: [{ sha: 'm1', message: 'main', author: 'dev', timeMs: 0, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'feature',
          headSha: 'f2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'f2', message: 'feature tip', author: 'dev', timeMs: 2, parentSha: 'f1' },
            { sha: 'f1', message: 'feature base', author: 'dev', timeMs: 1, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          hasUncommittedChanges: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'feature',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);
    const featureTip = rows.find((row) => row.kind === 'commit' && row.commit?.sha === 'f2');
    const featureBase = rows.find((row) => row.kind === 'commit' && row.commit?.sha === 'f1');
    const trunkRow = rows.find((row) => row.kind === 'commit' && row.commit?.sha === 'm1');

    expect(featureTip).toMatchObject({ isBranchTip: true, canCreateBranchAtCommit: false });
    expect(featureBase).toMatchObject({ isBranchTip: false, canCreateBranchAtCommit: true });
    expect(trunkRow).toMatchObject({ isTrunkBranch: true, canCreateBranchAtCommit: false });
  });
});
