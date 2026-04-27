import type { StackBranch, StackState } from '../protocol';

export type SquashBlockReason =
  | 'branch_not_found'
  | 'is_trunk'
  | 'merged_into_trunk'
  | 'no_parent'
  | 'parent_not_found'
  | 'parent_is_trunk'
  | 'out_of_sync'
  | 'dirty_tree'
  | 'no_commits';

export interface SquashPlan {
  branchRef: string;
  parentRef: string;
  newCommitMessageByChoice: {
    parent: string;
    child: string;
  };
  parentHeadSha: string;
  childHeadSha: string;
  isEmpty: boolean;
}

export type SquashPlannerResult =
  | { ok: true; plan: SquashPlan }
  | { ok: false; reason: SquashBlockReason; detail?: string };

export class SquashPlannerUtils {
  static plan(state: StackState, branchRef: string): SquashPlannerResult {
    const branchesByRef = new Map(state.branches.map((b) => [b.ref, b]));
    const branch = branchesByRef.get(branchRef);
    if (!branch) {
      return { ok: false, reason: 'branch_not_found' };
    }
    if (branch.isTrunk) {
      return { ok: false, reason: 'is_trunk' };
    }
    if (branch.isMergedIntoTrunk) {
      return { ok: false, reason: 'merged_into_trunk' };
    }
    if (!branch.parentRef) {
      return { ok: false, reason: 'no_parent' };
    }
    const parent = branchesByRef.get(branch.parentRef);
    if (!parent) {
      return { ok: false, reason: 'parent_not_found' };
    }
    if (parent.isTrunk) {
      return { ok: false, reason: 'parent_is_trunk' };
    }
    if (branch.baseSha !== parent.headSha) {
      return { ok: false, reason: 'out_of_sync' };
    }

    const currentBranch = state.branches.find((b) => b.isCurrent);
    if (currentBranch?.hasUncommittedChanges) {
      return { ok: false, reason: 'dirty_tree' };
    }

    const isEmpty = branch.commits.length === 0;
    const parentTipMsg = firstCommitMessage(parent);
    const childTipMsg = firstCommitMessage(branch);

    if (!isEmpty && !childTipMsg && !parentTipMsg) {
      return { ok: false, reason: 'no_commits' };
    }

    return {
      ok: true,
      plan: {
        branchRef: branch.ref,
        parentRef: parent.ref,
        parentHeadSha: parent.headSha,
        childHeadSha: branch.headSha,
        isEmpty,
        newCommitMessageByChoice: {
          parent: parentTipMsg,
          child: isEmpty ? parentTipMsg : childTipMsg || parentTipMsg,
        },
      },
    };
  }

  static describeBlocker(reason: SquashBlockReason, branchRef: string): string {
    switch (reason) {
      case 'branch_not_found':
        return `Branch "${branchRef}" not found.`;
      case 'is_trunk':
        return `Cannot squash the trunk branch.`;
      case 'merged_into_trunk':
        return `"${branchRef}" is already merged into trunk.`;
      case 'no_parent':
        return `"${branchRef}" has no parent branch to squash into.`;
      case 'parent_not_found':
        return `Parent branch of "${branchRef}" is missing.`;
      case 'parent_is_trunk':
        return `Cannot squash directly into trunk. Rebase & merge instead.`;
      case 'out_of_sync':
        return `"${branchRef}" is not based on its parent's tip. Rebase it first.`;
      case 'dirty_tree':
        return `Working tree has uncommitted changes. Commit or stash them first.`;
      case 'no_commits':
        return `No commit messages available for squash.`;
    }
  }
}

function firstCommitMessage(branch: StackBranch): string {
  return branch.commits[0]?.message ?? '';
}
