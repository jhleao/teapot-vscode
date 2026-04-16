import type { StackBranch, StackState } from '../../protocol';

const GRAPH_COLOR = 'var(--vscode-descriptionForeground, #858585)';
const TRUNK_COLOR = 'var(--vscode-descriptionForeground, #858585)';
const CURRENT_COLOR = 'var(--vscode-focusBorder, var(--vscode-button-background, #007fd4))';

type ChildRefsByBaseSha = Map<string, string[]>;

export interface RowLane {
  lane: number;
  color: string;
}

export interface RowCommit {
  sha: string;
  message: string;
  author: string;
}

export interface RowModel {
  kind: 'branch-header' | 'commit';
  branchName: string;
  lane: number;
  laneColor: string;
  passThrough: RowLane[];
  parentLane?: number;
  commit?: RowCommit;
  isCurrent: boolean;
  isBranchTip: boolean;
  hasTop: boolean;
  hasBottom: boolean;
}

export function layoutRows(state: StackState): RowModel[] {
  const branchesByRef = new Map<string, StackBranch>();
  for (const branch of state.branches) {
    branchesByRef.set(branch.ref, branch);
  }

  const childRefsByParentAndBase = createChildRefsByParentAndBase(state.branches);

  const laneOf = (branchRef: string): number => (branchesByRef.get(branchRef)?.isTrunk ? 0 : 1);
  const colorOf = (branchRef: string): string => {
    const branch = branchesByRef.get(branchRef);
    if (branch?.isCurrent) {
      return CURRENT_COLOR;
    }

    return branch?.isTrunk ? TRUNK_COLOR : GRAPH_COLOR;
  };

  const currentChain = collectCurrentChain(state.current, branchesByRef);
  const subtreeContainsCurrent = new Map<string, boolean>();
  const containsCurrent = (branchRef: string): boolean => {
    const cached = subtreeContainsCurrent.get(branchRef);
    if (cached !== undefined) {
      return cached;
    }

    if (currentChain.has(branchRef)) {
      subtreeContainsCurrent.set(branchRef, true);
      return true;
    }

    const branch = branchesByRef.get(branchRef);
    const result = branch?.childRefs.some(containsCurrent) ?? false;
    subtreeContainsCurrent.set(branchRef, result);
    return result;
  };

  const rows: RowModel[] = [];
  const rootRefs = state.branches
    .filter((branch) => !branch.parentRef)
    .map((branch) => branch.ref)
    .sort(
      (left, right) =>
        Number(!!branchesByRef.get(left)?.isTrunk) - Number(!!branchesByRef.get(right)?.isTrunk)
    );

  const emitBranch = (branchRef: string): void => {
    const branch = branchesByRef.get(branchRef);
    if (!branch) {
      return;
    }

    const lane = laneOf(branchRef);
    const parentLane = branch.parentRef ? laneOf(branch.parentRef) : undefined;
    const willRenderBranchHeader = parentLane !== undefined && parentLane !== lane;
    const passThrough = branch.isTrunk ? [] : [{ lane: 0, color: TRUNK_COLOR }];
    const childRefsAtBaseSha = childRefsByParentAndBase.get(branch.ref) ?? new Map();
    const renderedCommits = getRenderedCommits(branch, childRefsAtBaseSha);
    const hasChildrenAbove =
      renderedCommits[0] !== undefined &&
      (childRefsAtBaseSha.get(renderedCommits[0].sha)?.length ?? 0) > 0;

    if (renderedCommits.length === 0) {
      rows.push({
        kind: 'commit',
        branchName: branch.ref,
        lane,
        laneColor: colorOf(branch.ref),
        passThrough,
        isCurrent: branch.isCurrent,
        isBranchTip: true,
        hasTop: hasChildrenAbove,
        hasBottom: willRenderBranchHeader || !!branch.parentRef,
      });
    }

    for (const [index, commit] of renderedCommits.entries()) {
      const childRefs = sortChildRefs(
        childRefsAtBaseSha.get(commit.sha) ?? [],
        containsCurrent
      );

      for (const childRef of childRefs) {
        emitBranch(childRef);
      }

      const isBranchTip = index === 0;
      const isLastCommit = index === renderedCommits.length - 1;

      rows.push({
        kind: 'commit',
        branchName: branch.ref,
        lane,
        laneColor: colorOf(branch.ref),
        passThrough,
        commit: {
          sha: commit.sha,
          message: commit.message,
          author: commit.author,
        },
        isCurrent: isBranchTip && branch.isCurrent,
        isBranchTip,
        hasTop: isBranchTip ? hasChildrenAbove : true,
        hasBottom: isLastCommit ? willRenderBranchHeader || !!branch.parentRef : true,
      });
    }

    if (willRenderBranchHeader) {
      rows.push({
        kind: 'branch-header',
        branchName: branch.ref,
        lane,
        laneColor: colorOf(branch.ref),
        passThrough,
        parentLane,
        isCurrent: false,
        isBranchTip: false,
        hasTop: true,
        hasBottom: true,
      });
    }
  };

  for (const rootRef of rootRefs) {
    emitBranch(rootRef);
  }

  return rows;
}

function createChildRefsByParentAndBase(branches: StackBranch[]): Map<string, ChildRefsByBaseSha> {
  const childRefsByParentAndBase = new Map<string, ChildRefsByBaseSha>();

  for (const branch of branches) {
    if (!branch.parentRef) {
      continue;
    }

    if (!childRefsByParentAndBase.has(branch.parentRef)) {
      childRefsByParentAndBase.set(branch.parentRef, new Map());
    }

    const childRefsByBaseSha = childRefsByParentAndBase.get(branch.parentRef)!;
    const childRefs = childRefsByBaseSha.get(branch.baseSha) ?? [];
    childRefs.push(branch.ref);
    childRefsByBaseSha.set(branch.baseSha, childRefs);
  }

  return childRefsByParentAndBase;
}

function sortChildRefs(
  childRefs: string[],
  containsCurrent: (branchRef: string) => boolean
): string[] {
  return [...childRefs].sort((left, right) => {
    const leftContainsCurrent = containsCurrent(left) ? 0 : 1;
    const rightContainsCurrent = containsCurrent(right) ? 0 : 1;
    if (leftContainsCurrent !== rightContainsCurrent) {
      return leftContainsCurrent - rightContainsCurrent;
    }

    return left.localeCompare(right);
  });
}

function getRenderedCommits(
  branch: StackBranch,
  childRefsAtBaseSha: ChildRefsByBaseSha
): StackBranch['commits'] {
  if (!branch.isTrunk || branch.commits.length <= 1) {
    return branch.commits;
  }

  // Mirror Teapot's decluttered trunk rendering: keep the tip and every
  // branch attachment point, then compress the unannotated trunk-only commits
  // that sit between them.
  const visibleShas = new Set<string>([branch.headSha]);
  for (const baseSha of childRefsAtBaseSha.keys()) {
    visibleShas.add(baseSha);
  }

  return branch.commits.filter((commit) => visibleShas.has(commit.sha));
}

function collectCurrentChain(
  currentRef: string | null,
  branchesByRef: Map<string, StackBranch>
): Set<string> {
  const refs = new Set<string>();
  let branchRef = currentRef;

  while (branchRef) {
    refs.add(branchRef);
    branchRef = branchesByRef.get(branchRef)?.parentRef ?? null;
  }

  return refs;
}
