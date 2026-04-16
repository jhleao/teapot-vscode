import type { RebaseIntent, RebaseIntentNode, StackBranch, StackState } from '../protocol';

export function createRebaseIntent(
  state: StackState,
  branchRef: string,
  targetBaseSha: string
): RebaseIntent | null {
  const branchByRef = indexBranchesByRef(state.branches);
  const sourceBranch = branchByRef.get(branchRef);
  if (!sourceBranch) {
    return null;
  }

  if (sourceBranch.ownedShas.length === 0) {
    return null;
  }

  if (targetBaseSha === sourceBranch.baseSha || targetBaseSha === sourceBranch.headSha) {
    return null;
  }

  const subtreeBranchRefs = collectSubtreeBranchRefs(branchRef, branchByRef);
  const targetBranchRef = resolveIntentTargetBranchRef(state, targetBaseSha, subtreeBranchRefs);
  if (!targetBranchRef) {
    return null;
  }

  return {
    root: buildIntentNode(sourceBranch, branchByRef, new Set<string>()),
    targetBaseSha,
    targetBranchRef,
  };
}

export function isRebaseIntentValid(state: StackState, intent: RebaseIntent): boolean {
  const branchByRef = indexBranchesByRef(state.branches);
  if (!branchByRef.has(intent.root.branchRef)) {
    return false;
  }

  const subtreeBranchRefs = collectIntentBranchRefs(intent.root);
  return resolveIntentTargetBranchRef(state, intent.targetBaseSha, subtreeBranchRefs) !== null;
}

export function collectIntentBranchRefs(node: RebaseIntentNode): Set<string> {
  const refs = new Set<string>();
  visitIntentNodes(node, (current) => {
    refs.add(current.branchRef);
  });
  return refs;
}

export function collectPromptingShas(intent: RebaseIntent): Set<string> {
  return new Set(intent.root.ownedShas);
}

export function collectIdleShas(intent: RebaseIntent): Set<string> {
  const idleShas = new Set<string>();
  for (const child of intent.root.children) {
    visitIntentNodes(child, (node) => {
      for (const sha of node.ownedShas) {
        idleShas.add(sha);
      }
    });
  }
  return idleShas;
}

export function visitIntentNodes(
  node: RebaseIntentNode,
  visitor: (node: RebaseIntentNode) => void
): void {
  visitor(node);
  for (const child of node.children) {
    visitIntentNodes(child, visitor);
  }
}

export function indexBranchesByRef(branches: StackBranch[]): Map<string, StackBranch> {
  return new Map(branches.map((branch) => [branch.ref, branch]));
}

export function findOwningBranchRef(
  branches: StackBranch[],
  targetBaseSha: string,
  excludedBranchRefs: ReadonlySet<string> = new Set<string>()
): string | null {
  const exactHeadMatch = branches.find(
    (branch) => !excludedBranchRefs.has(branch.ref) && branch.headSha === targetBaseSha
  );
  if (exactHeadMatch) {
    return exactHeadMatch.ref;
  }

  const ownedMatch = branches.find(
    (branch) => !excludedBranchRefs.has(branch.ref) && branch.ownedShas.includes(targetBaseSha)
  );
  return ownedMatch?.ref ?? null;
}

function resolveIntentTargetBranchRef(
  state: StackState,
  targetBaseSha: string,
  excludedBranchRefs: ReadonlySet<string>
): string | null {
  if (isCommitInBranchSet(state.branches, targetBaseSha, excludedBranchRefs)) {
    return null;
  }

  return findOwningBranchRef(state.branches, targetBaseSha, excludedBranchRefs);
}

function buildIntentNode(
  branch: StackBranch,
  branchByRef: Map<string, StackBranch>,
  visitedBranchRefs: Set<string>
): RebaseIntentNode {
  visitedBranchRefs.add(branch.ref);

  return {
    branchRef: branch.ref,
    headSha: branch.headSha,
    baseSha: branch.baseSha,
    ownedShas: [...branch.ownedShas],
    children: branch.childRefs
      .map((childRef) => branchByRef.get(childRef))
      .filter(
        (child): child is StackBranch =>
          child != null && !visitedBranchRefs.has(child.ref)
      )
      .map((child) => buildIntentNode(child, branchByRef, new Set(visitedBranchRefs))),
  };
}

function collectSubtreeBranchRefs(
  rootBranchRef: string,
  branchByRef: Map<string, StackBranch>
): Set<string> {
  const refs = new Set<string>();
  const visit = (branchRef: string): void => {
    if (refs.has(branchRef)) {
      return;
    }

    refs.add(branchRef);
    const branch = branchByRef.get(branchRef);
    if (!branch) {
      return;
    }

    for (const childRef of branch.childRefs) {
      visit(childRef);
    }
  };

  visit(rootBranchRef);
  return refs;
}

function isCommitInBranchSet(
  branches: StackBranch[],
  targetBaseSha: string,
  branchRefs: ReadonlySet<string>
): boolean {
  return branches.some(
    (branch) =>
      branchRefs.has(branch.ref) &&
      (branch.headSha === targetBaseSha ||
        branch.baseSha === targetBaseSha ||
        branch.ownedShas.includes(targetBaseSha))
  );
}
