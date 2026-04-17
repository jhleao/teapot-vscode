import type { RebaseIntent, RebaseIntentNode, StackBranch, StackState } from '../protocol';
import { indexBranchesByRef, visitIntentNodes } from './intent';

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

  trimRebasedBranchesToHead(intent.root, branchByRef);

  rebuildChildRefs(branches);

  return {
    ...state,
    branches,
    pendingRebase: intent,
  };
}

// After a head-only rebase, each moved branch reduces to a single commit on
// top of its new base. Trim the projection so the preview reflects that.
function trimRebasedBranchesToHead(
  root: RebaseIntentNode,
  branchByRef: Map<string, StackBranch>
): void {
  visitIntentNodes(root, (node) => {
    const branch = branchByRef.get(node.branchRef);
    if (!branch) {
      return;
    }

    const headCommit = branch.commits.find((commit) => commit.sha === node.headSha);
    branch.commits = headCommit ? [headCommit] : [];
  });
}

function cloneBranch(branch: StackBranch): StackBranch {
  const commits = branch.commits.map((commit) => ({ ...commit }));

  return {
    ...branch,
    childRefs: [...branch.childRefs],
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
