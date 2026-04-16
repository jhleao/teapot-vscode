import type { RebaseIntent, StackBranch, StackState } from '../protocol';
import { indexBranchesByRef } from './intent';

export function applyRebaseIntentToState(state: StackState, intent: RebaseIntent): StackState {
  const branches = state.branches.map((branch) => cloneBranch(branch));
  const branchByRef = indexBranchesByRef(branches);
  const targetParent = branchByRef.get(intent.targetBranchRef ?? '');
  const rootBranch = branchByRef.get(intent.root.branchRef);

  if (!rootBranch || !targetParent) {
    return state;
  }

  rootBranch.parentRef = targetParent.ref;
  rootBranch.baseSha = intent.targetBaseSha;

  rebuildChildRefs(branches);

  return {
    ...state,
    branches,
    pendingRebase: intent,
  };
}

function cloneBranch(branch: StackBranch): StackBranch {
  const commits = branch.commits.map((commit) => ({ ...commit }));

  return {
    ...branch,
    childRefs: [...branch.childRefs],
    ownedShas: [...branch.ownedShas],
    commits,
  };
}

function rebuildChildRefs(branches: StackBranch[]): void {
  const childrenByParent = new Map<string, string[]>();

  for (const branch of branches) {
    if (!branch.parentRef) {
      continue;
    }

    const children = childrenByParent.get(branch.parentRef) ?? [];
    children.push(branch.ref);
    childrenByParent.set(branch.parentRef, children);
  }

  for (const branch of branches) {
    const childRefs = childrenByParent.get(branch.ref) ?? [];
    childRefs.sort((left, right) => left.localeCompare(right));
    branch.childRefs = [...childRefs];
  }
}
