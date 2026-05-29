import { describe, expect, it } from 'vitest';
import type { StackBranch, StackState } from '../../protocol';
import { SquashPlannerUtils } from '../squashPlanner';

describe('SquashPlannerUtils.plan', () => {
  it('builds a plan for a linear child → parent squash', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a1', baseSha: 'm1', parentRef: 'main', childRefs: ['feat-b'], commits: [{ sha: 'a1', message: 'feat a' }] }),
      branch({ ref: 'feat-b', headSha: 'b1', baseSha: 'a1', parentRef: 'feat-a', childRefs: [], commits: [{ sha: 'b1', message: 'feat b' }] }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-b');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      branchRef: 'feat-b',
      parentRef: 'feat-a',
      parentHeadSha: 'a1',
      childHeadSha: 'b1',
      isEmpty: false,
      newCommitMessageByChoice: { parent: 'feat a', child: 'feat b' },
    });
  });

  it('flags an empty squash when the child has no unique commits', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a1', baseSha: 'm1', parentRef: 'main', childRefs: ['feat-b'], commits: [{ sha: 'a1', message: 'feat a' }] }),
      branch({ ref: 'feat-b', headSha: 'a1', baseSha: 'a1', parentRef: 'feat-a', childRefs: [], commits: [] }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-b');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isEmpty).toBe(true);
    expect(result.plan.newCommitMessageByChoice.child).toBe('feat a');
  });

  it('blocks when parent is trunk', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a1', baseSha: 'm1', parentRef: 'main', childRefs: [], commits: [{ sha: 'a1', message: 'feat a' }] }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-a');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parent_is_trunk');
  });

  it('blocks trunk itself', () => {
    const state = makeState([trunk('main', 'm1')]);
    const result = SquashPlannerUtils.plan(state, 'main');
    expect(result).toEqual({ ok: false, reason: 'is_trunk' });
  });

  it('blocks a missing branch', () => {
    const state = makeState([trunk('main', 'm1')]);
    const result = SquashPlannerUtils.plan(state, 'ghost');
    expect(result).toEqual({ ok: false, reason: 'branch_not_found' });
  });

  it('allows squashing a branch with descendants (caller is responsible for rebasing them)', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a1', baseSha: 'm1', parentRef: 'main', childRefs: ['feat-b'], commits: [{ sha: 'a1', message: 'feat a' }] }),
      branch({ ref: 'feat-b', headSha: 'b1', baseSha: 'a1', parentRef: 'feat-a', childRefs: ['feat-c'], commits: [{ sha: 'b1', message: 'feat b' }] }),
      branch({ ref: 'feat-c', headSha: 'c1', baseSha: 'b1', parentRef: 'feat-b', childRefs: [], commits: [{ sha: 'c1', message: 'feat c' }] }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-b');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.parentRef).toBe('feat-a');
  });

  it('blocks when parent has moved ahead (child out of sync)', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a2', baseSha: 'm1', parentRef: 'main', childRefs: ['feat-b'], commits: [{ sha: 'a2', message: 'a2' }, { sha: 'a1', message: 'a1' }] }),
      branch({ ref: 'feat-b', headSha: 'b1', baseSha: 'a1', parentRef: 'feat-a', childRefs: [], commits: [{ sha: 'b1', message: 'feat b' }] }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-b');
    expect(result).toEqual({ ok: false, reason: 'out_of_sync' });
  });

  it('blocks when the working tree is dirty', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a1', baseSha: 'm1', parentRef: 'main', childRefs: ['feat-b'], commits: [{ sha: 'a1', message: 'feat a' }] }),
      branch({ ref: 'feat-b', headSha: 'b1', baseSha: 'a1', parentRef: 'feat-a', childRefs: [], commits: [{ sha: 'b1', message: 'feat b' }], isCurrent: true, hasUncommittedChanges: true }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-b');
    expect(result).toEqual({ ok: false, reason: 'dirty_tree' });
  });

  it('blocks a branch already merged into trunk', () => {
    const state = makeState([
      trunk('main', 'm1'),
      branch({ ref: 'feat-a', headSha: 'a1', baseSha: 'm1', parentRef: 'main', childRefs: ['feat-b'], commits: [{ sha: 'a1', message: 'feat a' }] }),
      branch({ ref: 'feat-b', headSha: 'b1', baseSha: 'a1', parentRef: 'feat-a', childRefs: [], commits: [{ sha: 'b1', message: 'feat b' }], isMergedIntoTrunk: true }),
    ]);

    const result = SquashPlannerUtils.plan(state, 'feat-b');
    expect(result).toEqual({ ok: false, reason: 'merged_into_trunk' });
  });
});

type BranchOverrides = {
  ref: string;
  headSha: string;
  baseSha: string;
  parentRef: string | null;
  childRefs: string[];
  commits: Array<{ sha: string; message: string }>;
  isTrunk?: boolean;
  isCurrent?: boolean;
  hasUncommittedChanges?: boolean;
  isMergedIntoTrunk?: boolean;
};

function branch(opts: BranchOverrides): StackBranch {
  return {
    ref: opts.ref,
    headSha: opts.headSha,
    baseSha: opts.baseSha,
    parentRef: opts.parentRef,
    childRefs: opts.childRefs,
    commits: opts.commits.map((c, i) => ({
      sha: c.sha,
      message: c.message,
      author: 'dev',
      timeMs: i,
      parentSha: '',
    })),
    isTrunk: opts.isTrunk ?? false,
    isRemote: false,
    isCurrent: opts.isCurrent ?? false,
    hasUncommittedChanges: opts.hasUncommittedChanges ?? false,
    worktreePath: null,
    worktreePeacockColor: null,
    pullRequest: null,
    needsAttention: false, isMergedIntoTrunk: opts.isMergedIntoTrunk ?? false,
  };
}

function trunk(ref: string, sha: string): StackBranch {
  return branch({
    ref,
    headSha: sha,
    baseSha: sha,
    parentRef: null,
    childRefs: [],
    commits: [{ sha, message: 'trunk' }],
    isTrunk: true,
  });
}

function makeState(branches: StackBranch[]): StackState {
  const current = branches.find((b) => b.isCurrent);
  const trunkBranch = branches.find((b) => b.isTrunk);
  return {
    branches,
    trunk: trunkBranch?.ref ?? null,
    current: current?.ref ?? null,
    repoRoot: '/repo',
    error: null,
    pendingRebase: null,
    activeRebase: null,
  };
}
