import { collectIdleShas, collectPromptingShas } from '../../rebase/intent';
import type { PullRequestInfo, StackBranch, StackState } from '../../protocol';

const GRAPH_COLOR = 'var(--vscode-descriptionForeground, #858585)';
const TRUNK_COLOR = 'var(--vscode-descriptionForeground, #858585)';
const CURRENT_COLOR = 'var(--vscode-focusBorder, var(--vscode-button-background, #007fd4))';
const EMPTY_LANES: RowLane[] = [];

type ChildRefsByBaseSha = Map<string, string[]>;

interface SpinoffAttachment {
  primaryRef: string;
  attachSha: string;
}

interface LayoutContext {
  branchesByRef: Map<string, StackBranch>;
  commitTimesBySha: Map<string, number>;
  childRefsByParentAndBase: Map<string, ChildRefsByBaseSha>;
  additionalRefsByPrimary: Map<string, string[]>;
  collapsedBranchRefs: Set<string>;
  primaryByCollapsed: Map<string, string>;
  // Sibling branches that share parentRef + baseSha are visually reattached
  // as spin-offs of one chosen "primary" sibling. Each non-primary gets its
  // own lane (primary lane + 1) and its own branch-header curve back to the
  // primary's lane — mirroring how original Teapot nests co-located spinoffs.
  reattachedSpinoffs: Map<string, SpinoffAttachment>;
  // Trailing ancestor commits that siblings share with the primary
  // (branchless commits between the divergence point and the shared base).
  // These get filtered out of the non-primary branches so the branchless
  // commit renders only once, under the primary.
  droppedCommitShasByBranch: Map<string, Set<string>>;
  laneByRef: Map<string, number>;
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
  canCreateBranchAtCommit: boolean;
}

export function layoutRows(state: StackState): RowModel[] {
  const {
    branchesByRef,
    commitTimesBySha,
    childRefsByParentAndBase,
    additionalRefsByPrimary,
    collapsedBranchRefs,
    reattachedSpinoffs,
    droppedCommitShasByBranch,
    laneByRef,
  } = createLayoutContext(state.branches);
  const laneOf = (branchRef: string): number => {
    const cached = laneByRef.get(branchRef);
    if (cached !== undefined) {
      return cached;
    }
    return branchesByRef.get(branchRef)?.isTrunk ? 0 : 1;
  };
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

  const emitBranch = (branchRef: string, ancestorLanes: readonly RowLane[]): void => {
    if (collapsedBranchRefs.has(branchRef)) {
      return;
    }
    const branch = branchesByRef.get(branchRef);
    if (!branch) {
      return;
    }

    const lane = laneOf(branchRef);
    const laneColor = colorOf(branch.ref);
    const spinoffAttachment = reattachedSpinoffs.get(branch.ref);
    const effectiveParentRef = spinoffAttachment?.primaryRef ?? branch.parentRef;
    const parentLane = effectiveParentRef ? laneOf(effectiveParentRef) : undefined;
    const willRenderBranchHeader = parentLane !== undefined && parentLane !== lane;
    // passThrough shows ancestor-branch spines that remain continuous across
    // this branch's rows — e.g. lane 0 (trunk) passes through every non-trunk
    // row, and when a spin-off nests inside a primary, the primary's lane
    // passes through the spin-off's rows too. Children we recurse into get
    // this branch's lane added so their rows keep our spine drawn.
    const passThrough = ancestorLanes.length === 0 ? EMPTY_LANES : ancestorLanes;
    const childAncestorLanes: RowLane[] = [...ancestorLanes, { lane, color: laneColor }];
    const childRefsAtBaseSha = childRefsByParentAndBase.get(branch.ref) ?? new Map();
    const droppedShas = droppedCommitShasByBranch.get(branch.ref);
    const renderedCommits = getRenderedCommits(branch, childRefsAtBaseSha, droppedShas);
    const hasChildrenAbove =
      renderedCommits[0] !== undefined &&
      (childRefsAtBaseSha.get(renderedCommits[0].sha)?.length ?? 0) > 0;

    if (renderedCommits.length === 0) {
      rows.push({
        kind: 'commit',
        branchName: branch.ref,
        lane,
        laneColor,
        passThrough,
        isCurrent: branch.isCurrent,
        isBranchTip: true,
        isTrunkBranch: branch.isTrunk,
        hasTop: hasChildrenAbove,
        hasBottom: willRenderBranchHeader || !!branch.parentRef,
        rebaseStatus: getRebaseStatus(branch.headSha, promptingShas, idleShas),
        showsRebaseActions: actionCommitSha === branch.headSha,
        isDraggable: !branch.isTrunk && branch.headSha !== branch.baseSha,
        worktreePath: branch.worktreePath,
        worktreePeacockColor: branch.worktreePeacockColor,
        pullRequest: branch.pullRequest,
        additionalBranchRefs: additionalRefsByPrimary.get(branch.ref) ?? [],
        canCreateBranchAtCommit: false,
      });
    }

    for (const [index, commit] of renderedCommits.entries()) {
      const childRefs = childRefsAtBaseSha.get(commit.sha) ?? [];

      for (const childRef of childRefs) {
        emitBranch(childRef, childAncestorLanes);
      }

      const isBranchTip = index === 0;
      const isLastCommit = index === renderedCommits.length - 1;

      rows.push({
        kind: 'commit',
        branchName: branch.ref,
        lane,
        laneColor,
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
        isDraggable: isBranchTip && !branch.isTrunk && branch.headSha !== branch.baseSha,
        worktreePath: isBranchTip ? branch.worktreePath : null,
        worktreePeacockColor: isBranchTip ? branch.worktreePeacockColor : null,
        pullRequest: isBranchTip ? branch.pullRequest : null,
        additionalBranchRefs: isBranchTip
          ? additionalRefsByPrimary.get(branch.ref) ?? []
          : [],
        canCreateBranchAtCommit: !isBranchTip && !branch.isTrunk,
      });
    }

    if (willRenderBranchHeader) {
      rows.push({
        kind: 'branch-header',
        branchName: branch.ref,
        lane,
        laneColor,
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
        canCreateBranchAtCommit: false,
      });
    }
  };

  for (const rootRef of rootRefs) {
    emitBranch(rootRef, EMPTY_LANES);
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
  const { reattachedSpinoffs, droppedCommitShasByBranch } = planSiblingSpinoffs(
    branches,
    branchesByRef,
    commitTimesBySha,
    collapsedBranchRefs
  );
  const childRefsByParentAndBase = childRefsByParentAndBaseIndex(
    branches,
    branchesByRef,
    commitTimesBySha,
    primaryByCollapsed,
    reattachedSpinoffs
  );
  const laneByRef = computeLaneByRef(branches, branchesByRef, reattachedSpinoffs);

  return {
    branchesByRef,
    commitTimesBySha,
    childRefsByParentAndBase,
    additionalRefsByPrimary,
    collapsedBranchRefs,
    primaryByCollapsed,
    reattachedSpinoffs,
    droppedCommitShasByBranch,
    laneByRef,
  };
}

// When two or more non-trunk sibling branches share parentRef + baseSha, they
// would otherwise render as a vertical stack of dots in the same lane —
// indistinguishable from a single branch. Pick one as the "primary" (last in
// sortChildRefs order, so it renders farthest from the tip / closest to the
// parent) and re-attach the rest as spin-offs of the primary.
//
// When the siblings share trailing (ancestor) commits — e.g. two feature
// branches both sitting above a branchless commit test1 — the non-primary
// siblings drop those shared commits from their rendered list and attach at
// the divergence commit (test1). That way test1 renders only once, under the
// primary, and the spin-off curves point at it. When there are no shared
// commits, non-primaries attach at the primary's tip.
//
// Lane assignment (computeLaneByRef) then places each non-primary at
// primaryLane + 1 so every sibling gets its own curve back to the primary.
// Git topology on StackBranch itself is left untouched — rebase/drag planning
// still sees the real graph.
function planSiblingSpinoffs(
  branches: StackBranch[],
  branchesByRef: Map<string, StackBranch>,
  commitTimesBySha: ReadonlyMap<string, number>,
  collapsedBranchRefs: ReadonlySet<string>
): {
  reattachedSpinoffs: Map<string, SpinoffAttachment>;
  droppedCommitShasByBranch: Map<string, Set<string>>;
} {
  const reattachedSpinoffs = new Map<string, SpinoffAttachment>();
  const droppedCommitShasByBranch = new Map<string, Set<string>>();

  const groupsByParentBase = new Map<string, StackBranch[]>();
  for (const branch of branches) {
    if (branch.isTrunk || branch.isRemote) continue;
    if (collapsedBranchRefs.has(branch.ref)) continue;
    if (!branch.parentRef) continue;
    const key = `${branch.parentRef}\x00${branch.baseSha}`;
    const list = groupsByParentBase.get(key) ?? [];
    list.push(branch);
    groupsByParentBase.set(key, list);
  }

  for (const group of groupsByParentBase.values()) {
    if (group.length < 2) continue;

    const sortedRefs = sortChildRefs(
      group.map((b) => b.ref),
      branchesByRef,
      commitTimesBySha
    );
    const primaryRef = sortedRefs[sortedRefs.length - 1];
    const primary = branchesByRef.get(primaryRef);
    if (!primary) continue;

    // Per-sibling: count trailing commits that this non-primary shares with
    // the primary, walking both from the tail (oldest-first). A sibling only
    // becomes a spin-off if it shares at least one ancestor commit with the
    // primary — otherwise it stays as an independent peer under the real
    // parent (e.g. `laks` and `ioqw` alongside `branch2` under `main`).
    for (const branch of group) {
      if (branch.ref === primaryRef) continue;

      const maxShared = Math.min(branch.commits.length, primary.commits.length);
      let sharedLength = 0;
      for (let i = 0; i < maxShared; i += 1) {
        const primarySha = primary.commits[primary.commits.length - 1 - i]?.sha;
        const siblingSha = branch.commits[branch.commits.length - 1 - i]?.sha;
        if (!primarySha || !siblingSha || primarySha !== siblingSha) break;
        sharedLength += 1;
      }

      if (sharedLength === 0) continue;

      const sharedShaSet = new Set<string>();
      for (let i = 0; i < sharedLength; i += 1) {
        sharedShaSet.add(primary.commits[primary.commits.length - 1 - i].sha);
      }
      // Topmost shared commit (closest to tips) = the divergence point.
      const attachSha = primary.commits[primary.commits.length - sharedLength].sha;

      reattachedSpinoffs.set(branch.ref, { primaryRef, attachSha });
      droppedCommitShasByBranch.set(branch.ref, sharedShaSet);
    }
  }

  return { reattachedSpinoffs, droppedCommitShasByBranch };
}

// Trunk → 0. Natural non-trunk branches → 1. Reattached spin-off siblings →
// primary's lane + 1 (resolved recursively for chains of reattachments).
function computeLaneByRef(
  branches: StackBranch[],
  branchesByRef: Map<string, StackBranch>,
  reattachedSpinoffs: ReadonlyMap<string, SpinoffAttachment>
): Map<string, number> {
  const laneByRef = new Map<string, number>();
  const visiting = new Set<string>();

  const resolve = (ref: string): number => {
    const cached = laneByRef.get(ref);
    if (cached !== undefined) return cached;
    // Cycle guard — shouldn't happen with well-formed reattachments.
    if (visiting.has(ref)) return 1;
    visiting.add(ref);

    const branch = branchesByRef.get(ref);
    let lane: number;
    if (!branch) {
      lane = 1;
    } else if (branch.isTrunk) {
      lane = 0;
    } else {
      const attachment = reattachedSpinoffs.get(ref);
      if (attachment) {
        lane = resolve(attachment.primaryRef) + 1;
      } else if (branch.parentRef) {
        // Non-reattached, non-trunk descendants stay on the same spine as
        // their parent. Without this, a child of a spin-off (e.g. jhleao
        // under feat/overview-…) would drop back to lane 1 and detach from
        // its parent's column.
        const parentLane = resolve(branch.parentRef);
        lane = parentLane === 0 ? 1 : parentLane;
      } else {
        lane = 1;
      }
    }

    visiting.delete(ref);
    laneByRef.set(ref, lane);
    return lane;
  };

  for (const branch of branches) {
    resolve(branch.ref);
  }

  return laneByRef;
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
  primaryByCollapsed: ReadonlyMap<string, string>,
  reattachedSpinoffs: ReadonlyMap<string, SpinoffAttachment>
): Map<string, ChildRefsByBaseSha> {
  const childRefsByParentAndBase = new Map<string, ChildRefsByBaseSha>();

  for (const branch of branches) {
    if (!branch.parentRef) {
      continue;
    }

    // Spin-offs reattach to a sibling primary at the primary's tip commit,
    // rather than to their real git parent — that's what produces the
    // cascading spin-off look when several branches share a parent+base.
    const spinoffAttachment = reattachedSpinoffs.get(branch.ref);
    let effectiveParentRef: string;
    let effectiveBaseSha: string;
    if (spinoffAttachment) {
      effectiveParentRef = spinoffAttachment.primaryRef;
      effectiveBaseSha = spinoffAttachment.attachSha;
    } else {
      // Re-route children of a collapsed branch onto its primary. The
      // collapsed branch has no row of its own, so children attached to it
      // would otherwise become unreachable during the emit walk.
      effectiveParentRef =
        primaryByCollapsed.get(branch.parentRef) ?? branch.parentRef;
      effectiveBaseSha = branch.baseSha;
    }

    const childRefsByBaseSha = childRefsByParentAndBase.get(effectiveParentRef) ?? new Map();
    const childRefs = childRefsByBaseSha.get(effectiveBaseSha) ?? [];
    childRefs.push(branch.ref);
    childRefsByBaseSha.set(effectiveBaseSha, childRefs);
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
  childRefsAtBaseSha: ChildRefsByBaseSha,
  droppedShas: ReadonlySet<string> | undefined
): StackBranch['commits'] {
  const filterDropped = (commits: StackBranch['commits']): StackBranch['commits'] =>
    droppedShas && droppedShas.size > 0
      ? commits.filter((commit) => !droppedShas.has(commit.sha))
      : commits;

  if (!branch.isTrunk || branch.commits.length <= 1) {
    return filterDropped(branch.commits);
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

  return filterDropped(renderedCommits);
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
    commitTimesBySha.get(branch.baseSha) ?? getBranchHeadTime(branch, commitTimesBySha)
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
