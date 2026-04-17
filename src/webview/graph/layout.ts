import { collectIdleShas, collectPromptingShas } from '../../rebase/intent';
import type { PullRequestInfo, StackBranch, StackState } from '../../protocol';

const GRAPH_COLOR = 'var(--vscode-descriptionForeground, #858585)';
const TRUNK_COLOR = 'var(--vscode-descriptionForeground, #858585)';
const CURRENT_COLOR = 'var(--vscode-focusBorder, var(--vscode-button-background, #007fd4))';
const EMPTY_LANES: RowLane[] = [];
const TRUNK_PASS_THROUGH: RowLane[] = [{ lane: 0, color: TRUNK_COLOR }];

type ChildRefsByBaseSha = Map<string, string[]>;

interface LayoutContext {
  branchesByRef: Map<string, StackBranch>;
  commitTimesBySha: Map<string, number>;
  childRefsByParentAndBase: Map<string, ChildRefsByBaseSha>;
  additionalRefsByPrimary: Map<string, string[]>;
  collapsedBranchRefs: Set<string>;
  primaryByCollapsed: Map<string, string>;
}

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
  isTrunkBranch: boolean;
  hasTop: boolean;
  hasBottom: boolean;
  rebaseStatus: 'prompting' | 'idle' | null;
  showsRebaseActions: boolean;
  isDraggable: boolean;
  worktreePath: string | null;
  worktreePeacockColor: string | null;
  pullRequest: PullRequestInfo | null;
  additionalBranchRefs: string[];
}

export function layoutRows(state: StackState): RowModel[] {
  const {
    branchesByRef,
    commitTimesBySha,
    childRefsByParentAndBase,
    additionalRefsByPrimary,
    collapsedBranchRefs,
  } = createLayoutContext(state.branches);
  const laneOf = (branchRef: string): number => (branchesByRef.get(branchRef)?.isTrunk ? 0 : 1);
  const colorOf = (branchRef: string): string => {
    const branch = branchesByRef.get(branchRef);
    if (branch?.isCurrent) {
      return CURRENT_COLOR;
    }

    return branch?.isTrunk ? TRUNK_COLOR : GRAPH_COLOR;
  };

  const rows: RowModel[] = [];
  const promptingShas = state.pendingRebase
    ? collectPromptingShas(state.pendingRebase)
    : new Set<string>();
  const idleShas = state.pendingRebase ? collectIdleShas(state.pendingRebase) : new Set<string>();
  const actionCommitSha = state.pendingRebase?.root.headSha ?? null;
  const rootRefs = getRootRefs(state.branches, branchesByRef, commitTimesBySha);

  const emitBranch = (branchRef: string): void => {
    if (collapsedBranchRefs.has(branchRef)) {
      return;
    }
    const branch = branchesByRef.get(branchRef);
    if (!branch) {
      return;
    }

    const lane = laneOf(branchRef);
    const parentLane = branch.parentRef ? laneOf(branch.parentRef) : undefined;
    const willRenderBranchHeader = parentLane !== undefined && parentLane !== lane;
    const passThrough = branch.isTrunk ? EMPTY_LANES : TRUNK_PASS_THROUGH;
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
        isTrunkBranch: branch.isTrunk,
        hasTop: hasChildrenAbove,
        hasBottom: willRenderBranchHeader || !!branch.parentRef,
        rebaseStatus: getRebaseStatus(branch.headSha, promptingShas, idleShas),
        showsRebaseActions: actionCommitSha === branch.headSha,
        isDraggable: !branch.isTrunk && branch.ownedShas.length > 0,
        worktreePath: branch.worktreePath,
        worktreePeacockColor: branch.worktreePeacockColor,
        pullRequest: branch.pullRequest,
        additionalBranchRefs: additionalRefsByPrimary.get(branch.ref) ?? [],
      });
    }

    for (const [index, commit] of renderedCommits.entries()) {
      const childRefs = childRefsAtBaseSha.get(commit.sha) ?? [];

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
        isTrunkBranch: branch.isTrunk,
        hasTop: isBranchTip ? hasChildrenAbove : true,
        hasBottom: isLastCommit ? willRenderBranchHeader || !!branch.parentRef : true,
        rebaseStatus: getRebaseStatus(commit.sha, promptingShas, idleShas),
        showsRebaseActions: actionCommitSha === commit.sha,
        isDraggable: isBranchTip && !branch.isTrunk && branch.ownedShas.length > 0,
        worktreePath: isBranchTip ? branch.worktreePath : null,
        worktreePeacockColor: isBranchTip ? branch.worktreePeacockColor : null,
        pullRequest: isBranchTip ? branch.pullRequest : null,
        additionalBranchRefs: isBranchTip
          ? additionalRefsByPrimary.get(branch.ref) ?? []
          : [],
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
        isTrunkBranch: branch.isTrunk,
        hasTop: true,
        hasBottom: true,
        rebaseStatus: null,
        showsRebaseActions: false,
        isDraggable: false,
        worktreePath: null,
        worktreePeacockColor: null,
        pullRequest: null,
        additionalBranchRefs: [],
      });
    }
  };

  for (const rootRef of rootRefs) {
    emitBranch(rootRef);
  }

  return rows;
}

function sortChildRefs(
  childRefs: string[],
  branchesByRef: Map<string, StackBranch>,
  commitTimesBySha: ReadonlyMap<string, number>
): string[] {
  return [...childRefs].sort((left, right) =>
    compareBranchRefsForLayout(left, right, branchesByRef, commitTimesBySha)
  );
}

function createLayoutContext(branches: StackBranch[]): LayoutContext {
  const branchesByRef = branchesByRefIndex(branches);
  const commitTimesBySha = commitTimesByShaIndex(branches);
  const { additionalRefsByPrimary, collapsedBranchRefs, primaryByCollapsed } =
    planSameShaCollapse(branches);
  const childRefsByParentAndBase = childRefsByParentAndBaseIndex(
    branches,
    branchesByRef,
    commitTimesBySha,
    primaryByCollapsed
  );

  return {
    branchesByRef,
    commitTimesBySha,
    childRefsByParentAndBase,
    additionalRefsByPrimary,
    collapsedBranchRefs,
    primaryByCollapsed,
  };
}

// When two or more local branches share a commit SHA — siblings at the same
// parent, a child sitting on its parent's tip, or any other configuration —
// only the primary gets its own row; the rest become a `+N` badge on that
// row. Remote tracking branches are kept as their own rows so they remain
// visible alongside the locals.
function planSameShaCollapse(branches: StackBranch[]): {
  additionalRefsByPrimary: Map<string, string[]>;
  collapsedBranchRefs: Set<string>;
  primaryByCollapsed: Map<string, string>;
} {
  const branchesByHeadSha = new Map<string, StackBranch[]>();
  for (const branch of branches) {
    if (branch.isRemote) {
      continue;
    }
    const list = branchesByHeadSha.get(branch.headSha) ?? [];
    list.push(branch);
    branchesByHeadSha.set(branch.headSha, list);
  }

  const additionalRefsByPrimary = new Map<string, string[]>();
  const collapsedBranchRefs = new Set<string>();
  const primaryByCollapsed = new Map<string, string>();

  for (const group of branchesByHeadSha.values()) {
    if (group.length < 2) {
      continue;
    }

    // Primary order: current first, then trunk, then input order. Trunk wins
    // the tiebreaker when nobody in the group is current so that, e.g., a
    // disposable child branch sitting on `main` collapses into `main`'s row.
    const sorted = [...group].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) {
        return a.isCurrent ? -1 : 1;
      }
      if (a.isTrunk !== b.isTrunk) {
        return a.isTrunk ? -1 : 1;
      }
      return 0;
    });

    const primary = sorted[0];
    const rest = sorted.slice(1);
    additionalRefsByPrimary.set(
      primary.ref,
      rest.map((branch) => branch.ref)
    );
    for (const branch of rest) {
      collapsedBranchRefs.add(branch.ref);
      primaryByCollapsed.set(branch.ref, primary.ref);
    }
  }

  return { additionalRefsByPrimary, collapsedBranchRefs, primaryByCollapsed };
}

function branchesByRefIndex(branches: StackBranch[]): Map<string, StackBranch> {
  return new Map(branches.map((branch) => [branch.ref, branch]));
}

function commitTimesByShaIndex(branches: StackBranch[]): Map<string, number> {
  const commitTimesBySha = new Map<string, number>();

  for (const branch of branches) {
    for (const commit of branch.commits) {
      if (!commitTimesBySha.has(commit.sha)) {
        commitTimesBySha.set(commit.sha, commit.timeMs);
      }
    }
  }

  return commitTimesBySha;
}

function childRefsByParentAndBaseIndex(
  branches: StackBranch[],
  branchesByRef: Map<string, StackBranch>,
  commitTimesBySha: ReadonlyMap<string, number>,
  primaryByCollapsed: ReadonlyMap<string, string>
): Map<string, ChildRefsByBaseSha> {
  const childRefsByParentAndBase = new Map<string, ChildRefsByBaseSha>();

  for (const branch of branches) {
    if (!branch.parentRef) {
      continue;
    }

    // Re-route children of a collapsed branch onto its primary. The collapsed
    // branch has no row of its own, so children attached to it would otherwise
    // become unreachable during the emit walk.
    const effectiveParentRef =
      primaryByCollapsed.get(branch.parentRef) ?? branch.parentRef;

    const childRefsByBaseSha = childRefsByParentAndBase.get(effectiveParentRef) ?? new Map();
    const childRefs = childRefsByBaseSha.get(branch.baseSha) ?? [];
    childRefs.push(branch.ref);
    childRefsByBaseSha.set(branch.baseSha, childRefs);
    childRefsByParentAndBase.set(effectiveParentRef, childRefsByBaseSha);
  }

  for (const childRefsByBaseSha of childRefsByParentAndBase.values()) {
    for (const [baseSha, childRefs] of childRefsByBaseSha) {
      childRefsByBaseSha.set(
        baseSha,
        sortChildRefs(childRefs, branchesByRef, commitTimesBySha)
      );
    }
  }

  return childRefsByParentAndBase;
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

  const renderedCommits: StackBranch['commits'] = [];

  for (const commit of branch.commits) {
    if (visibleShas.has(commit.sha)) {
      renderedCommits.push(commit);
    }
  }

  return renderedCommits;
}

function getRebaseStatus(
  sha: string,
  promptingShas: ReadonlySet<string>,
  idleShas: ReadonlySet<string>
): 'prompting' | 'idle' | null {
  if (promptingShas.has(sha)) {
    return 'prompting';
  }

  if (idleShas.has(sha)) {
    return 'idle';
  }

  return null;
}

function compareBranchRefsForLayout(
  leftRef: string,
  rightRef: string,
  branchesByRef: ReadonlyMap<string, StackBranch>,
  commitTimesBySha: ReadonlyMap<string, number>
): number {
  const left = branchesByRef.get(leftRef);
  const right = branchesByRef.get(rightRef);

  const trunkOrder = Number(!!left?.isTrunk) - Number(!!right?.isTrunk);
  if (trunkOrder !== 0) {
    return trunkOrder;
  }

  const baseTimeOrder = getBranchBaseTime(right, commitTimesBySha) - getBranchBaseTime(left, commitTimesBySha);
  if (baseTimeOrder !== 0) {
    return baseTimeOrder;
  }

  const headTimeOrder = getBranchHeadTime(right, commitTimesBySha) - getBranchHeadTime(left, commitTimesBySha);
  if (headTimeOrder !== 0) {
    return headTimeOrder;
  }

  return leftRef.localeCompare(rightRef);
}

function getBranchBaseTime(
  branch: StackBranch | undefined,
  commitTimesBySha: ReadonlyMap<string, number>
): number {
  if (!branch) {
    return 0;
  }

  return (
    commitTimesBySha.get(branch.baseSha) ??
    commitTimesBySha.get(branch.ownedShas.at(-1) ?? '') ??
    getBranchHeadTime(branch, commitTimesBySha)
  );
}

function getBranchHeadTime(
  branch: StackBranch | undefined,
  commitTimesBySha: ReadonlyMap<string, number>
): number {
  if (!branch) {
    return 0;
  }

  return commitTimesBySha.get(branch.headSha) ?? branch.commits[0]?.timeMs ?? 0;
}

function getRootRefs(
  branches: StackBranch[],
  branchesByRef: ReadonlyMap<string, StackBranch>,
  commitTimesBySha: ReadonlyMap<string, number>
): string[] {
  const rootRefs: string[] = [];

  for (const branch of branches) {
    if (!branch.parentRef) {
      rootRefs.push(branch.ref);
    }
  }

  rootRefs.sort((left, right) =>
    compareBranchRefsForLayout(left, right, branchesByRef, commitTimesBySha)
  );

  return rootRefs;
}
