import type { RebaseIntent, RebaseIntentNode, StackBranch, StackState } from '../protocol';

interface BranchLookupIndex {
  branchByRef: Map<string, StackBranch>;
  branchRefsByHeadSha: Map<string, string[]>;
  branchRefsByOwnedSha: Map<string, string[]>;
  branchRefsByRelevantSha: Map<string, string[]>;
}

interface RebaseIntentContext {
  branchLookup: BranchLookupIndex;
  sourceBranch: StackBranch;
  subtreeBranchRefs: Set<string>;
}

export interface RebaseIntentPlanner {
  createIntent: (targetBaseSha: string) => RebaseIntent | null;
  isValidTarget: (targetBaseSha: string) => boolean;
}

export function createRebaseIntent(
  state: StackState,
  branchRef: string,
  targetBaseSha: string
): RebaseIntent | null {
  return createRebaseIntentPlanner(state, branchRef).createIntent(targetBaseSha);
}

export function isRebaseIntentValid(state: StackState, intent: RebaseIntent): boolean {
  const branchLookup = createBranchLookupIndex(state.branches);
  if (!branchLookup.branchByRef.has(intent.root.branchRef)) {
    return false;
  }

  const subtreeBranchRefs = collectIntentBranchRefs(intent.root);
  return (
    resolveIntentTargetBranchRef(branchLookup, intent.targetBaseSha, subtreeBranchRefs) !== null
  );
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

export function createRebaseIntentResolver(
  state: StackState,
  branchRef: string
): (targetBaseSha: string) => RebaseIntent | null {
  return createRebaseIntentPlanner(state, branchRef).createIntent;
}

export function createRebaseTargetValidator(
  state: StackState,
  branchRef: string
): (targetBaseSha: string) => boolean {
  return createRebaseIntentPlanner(state, branchRef).isValidTarget;
}

export function createRebaseIntentPlanner(
  state: StackState,
  branchRef: string
): RebaseIntentPlanner {
  const context = createRebaseIntentContext(state, branchRef);
  if (!context) {
    return {
      createIntent: () => null,
      isValidTarget: () => false,
    };
  }

  return {
    createIntent(targetBaseSha: string): RebaseIntent | null {
      const targetBranchRef = resolveIntentTargetBranchRefFromContext(context, targetBaseSha);
      if (!targetBranchRef) {
        return null;
      }

      return {
        root: buildIntentNode(
          context.sourceBranch,
          context.branchLookup.branchByRef,
          new Set<string>()
        ),
        targetBaseSha,
        targetBranchRef,
      };
    },
    isValidTarget(targetBaseSha: string): boolean {
      return resolveIntentTargetBranchRefFromContext(context, targetBaseSha) !== null;
    },
  };
}

export function findOwningBranchRef(
  branches: StackBranch[],
  targetBaseSha: string,
  excludedBranchRefs: ReadonlySet<string> = new Set<string>()
): string | null {
  return findOwningBranchRefInLookup(
    createBranchLookupIndex(branches),
    targetBaseSha,
    excludedBranchRefs
  );
}

function resolveIntentTargetBranchRef(
  branchLookup: BranchLookupIndex,
  targetBaseSha: string,
  excludedBranchRefs: ReadonlySet<string>
): string | null {
  if (isCommitInBranchSet(branchLookup, targetBaseSha, excludedBranchRefs)) {
    return null;
  }

  return findOwningBranchRefInLookup(branchLookup, targetBaseSha, excludedBranchRefs);
}

function resolveIntentTargetBranchRefFromContext(
  context: RebaseIntentContext,
  targetBaseSha: string
): string | null {
  if (
    targetBaseSha === context.sourceBranch.baseSha ||
    targetBaseSha === context.sourceBranch.headSha
  ) {
    return null;
  }

  return resolveIntentTargetBranchRef(
    context.branchLookup,
    targetBaseSha,
    context.subtreeBranchRefs
  );
}

function buildIntentNode(
  branch: StackBranch,
  branchByRef: Map<string, StackBranch>,
  visitedBranchRefs: Set<string>
): RebaseIntentNode {
  visitedBranchRefs.add(branch.ref);
  const children: RebaseIntentNode[] = [];

  for (const childRef of branch.childRefs) {
    const child = branchByRef.get(childRef);
    if (!child || visitedBranchRefs.has(child.ref)) {
      continue;
    }

    children.push(buildIntentNode(child, branchByRef, new Set(visitedBranchRefs)));
  }

  return {
    branchRef: branch.ref,
    headSha: branch.headSha,
    baseSha: branch.baseSha,
    ownedShas: [...branch.ownedShas],
    children,
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
  branchLookup: BranchLookupIndex,
  targetBaseSha: string,
  branchRefs: ReadonlySet<string>
): boolean {
  return (
    branchLookup.branchRefsByRelevantSha
      .get(targetBaseSha)
      ?.some((branchRef) => branchRefs.has(branchRef)) ?? false
  );
}

function createBranchLookupIndex(branches: StackBranch[]): BranchLookupIndex {
  const branchByRef = indexBranchesByRef(branches);
  const branchRefsByHeadSha = new Map<string, string[]>();
  const branchRefsByOwnedSha = new Map<string, string[]>();
  const branchRefsByRelevantSha = new Map<string, string[]>();

  for (const branch of branches) {
    pushIndexedBranchRef(branchRefsByHeadSha, branch.headSha, branch.ref);
    pushIndexedBranchRef(branchRefsByRelevantSha, branch.headSha, branch.ref);
    pushIndexedBranchRef(branchRefsByRelevantSha, branch.baseSha, branch.ref);

    for (const ownedSha of branch.ownedShas) {
      pushIndexedBranchRef(branchRefsByOwnedSha, ownedSha, branch.ref);
      pushIndexedBranchRef(branchRefsByRelevantSha, ownedSha, branch.ref);
    }
  }

  // When multiple branches share a SHA, prefer trunk so dropping onto the
  // visible trunk row always resolves to trunk rather than a sibling branch
  // that happens to be stuck at the same commit.
  sortIndexPreferringTrunk(branchRefsByHeadSha, branchByRef);
  sortIndexPreferringTrunk(branchRefsByOwnedSha, branchByRef);
  sortIndexPreferringTrunk(branchRefsByRelevantSha, branchByRef);

  return {
    branchByRef,
    branchRefsByHeadSha,
    branchRefsByOwnedSha,
    branchRefsByRelevantSha,
  };
}

function sortIndexPreferringTrunk(
  index: Map<string, string[]>,
  branchByRef: ReadonlyMap<string, StackBranch>
): void {
  for (const refs of index.values()) {
    refs.sort((left, right) => {
      const leftTrunk = branchByRef.get(left)?.isTrunk ? 1 : 0;
      const rightTrunk = branchByRef.get(right)?.isTrunk ? 1 : 0;
      return rightTrunk - leftTrunk;
    });
  }
}

function createRebaseIntentContext(
  state: StackState,
  branchRef: string
): RebaseIntentContext | null {
  const branchLookup = createBranchLookupIndex(state.branches);
  const sourceBranch = branchLookup.branchByRef.get(branchRef);
  if (!sourceBranch || sourceBranch.ownedShas.length === 0) {
    return null;
  }

  return {
    branchLookup,
    sourceBranch,
    subtreeBranchRefs: collectSubtreeBranchRefs(branchRef, branchLookup.branchByRef),
  };
}

function findOwningBranchRefInLookup(
  branchLookup: BranchLookupIndex,
  targetBaseSha: string,
  excludedBranchRefs: ReadonlySet<string>
): string | null {
  const exactHeadMatch = firstIncludedBranchRef(
    branchLookup.branchRefsByHeadSha.get(targetBaseSha),
    excludedBranchRefs
  );
  if (exactHeadMatch) {
    return exactHeadMatch;
  }

  return (
    firstIncludedBranchRef(branchLookup.branchRefsByOwnedSha.get(targetBaseSha), excludedBranchRefs) ??
    null
  );
}

function firstIncludedBranchRef(
  branchRefs: readonly string[] | undefined,
  excludedBranchRefs: ReadonlySet<string>
): string | null {
  if (!branchRefs) {
    return null;
  }

  for (const branchRef of branchRefs) {
    if (!excludedBranchRefs.has(branchRef)) {
      return branchRef;
    }
  }

  return null;
}

function pushIndexedBranchRef(
  index: Map<string, string[]>,
  sha: string,
  branchRef: string
): void {
  const branchRefs = index.get(sha) ?? [];
  branchRefs.push(branchRef);
  index.set(sha, branchRefs);
}
