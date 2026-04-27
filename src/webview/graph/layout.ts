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
  // Refs that share the primary's row but render as their own full label
  // (next to the primary's), instead of folding into the `+N` overflow badge.
  // Currently used for the checked-out branch when it shares its tip with
  // trunk — both labels stay visible on the trunk row.
  coPrimaryRefsByPrimary: Map<string, string[]>;
  collapsedBranchRefs: Set<string>;
  primaryByCollapsed: Map<string, string>;
  // Sibling branches that share parentRef + baseSha are visually reattached
  // as spin-offs of one chosen "primary" sibling. Each non-primary gets its
  // own lane (primary lane + 1) and its own branch-header curve back to the
  // primary's lane — mirroring how original Teapot nests co-located spinoffs.
  //
  // reattachedSpinoffs is for siblings that share trailing commits with the
  // primary: they reroute their parent to the primary's divergence commit
  // and drop the shared commits. coLocatedSpinoffPrimaries is for siblings
  // that share no commits (just the same parent tip): they stay as children
  // of the real parent in childRefsByParentAndBase, but take primaryLane+1
  // for their own lane, rendering as peers-to-the-side of the primary.
  reattachedSpinoffs: Map<string, SpinoffAttachment>;
  coLocatedSpinoffPrimaries: Map<string, string>;
  // Trailing ancestor commits that siblings share with the primary
  // (branchless commits between the divergence point and the shared base).
  // These get filtered out of the non-primary branches so the branchless
  // commit renders only once, under the primary.
  droppedCommitShasByBranch: Map<string, Set<string>>;
  laneByRef: Map<string, number>;
  // Non-trunk branches whose headSha matches an inner trunk commit SHA (not
  // trunk's tip) are collapsed into that trunk commit's row, shown as a ref
  // label alongside the commit instead of their own empty lane row. Keyed by
  // trunk commit SHA → list of collapsed branch refs.
  pointerBranchRefsByTrunkSha: Map<string, string[]>;
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
  passThrough: readonly RowLane[];
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
  // Refs that share this row but render as their own full branch label
  // alongside the primary, instead of folding into `additionalBranchRefs`'s
  // overflow badge. Populated only on the primary's branch-tip row.
  coPrimaryBranchRefs: string[];
  // Refs to non-trunk branches that collapse onto this row because their
  // headSha matches this commit's SHA (and they have no unique commits).
  // Populated only on trunk commit rows; empty elsewhere.
  pointerBranchRefs: string[];
  canCreateBranchAtCommit: boolean;
}

export function layoutRows(state: StackState): RowModel[] {
  const {
    branchesByRef,
    commitTimesBySha,
    childRefsByParentAndBase,
    additionalRefsByPrimary,
    coPrimaryRefsByPrimary,
    collapsedBranchRefs,
    primaryByCollapsed,
    reattachedSpinoffs,
    droppedCommitShasByBranch,
    laneByRef,
    pointerBranchRefsByTrunkSha,
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
    // Follow primaryByCollapsed so that a branch whose topology parent was
    // collapsed (e.g. a pointer branch) draws its lane curve back to the
    // surviving primary (trunk) rather than to a ref that no longer renders.
    const collapsedRedirect = branch.parentRef
      ? primaryByCollapsed.get(branch.parentRef)
      : undefined;
    const effectiveParentRef =
      spinoffAttachment?.primaryRef ?? collapsedRedirect ?? branch.parentRef;
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
        coPrimaryBranchRefs: coPrimaryRefsByPrimary.get(branch.ref) ?? [],
        pointerBranchRefs: [],
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
        coPrimaryBranchRefs: isBranchTip
          ? coPrimaryRefsByPrimary.get(branch.ref) ?? []
          : [],
        pointerBranchRefs: branch.isTrunk
          ? pointerBranchRefsByTrunkSha.get(commit.sha) ?? []
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
        coPrimaryBranchRefs: [],
        pointerBranchRefs: [],
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
  commitTimesBySha: ReadonlyMap<string, number>,
  coLocatedSpinoffPrimaries?: ReadonlyMap<string, string>
): string[] {
  // Members of a co-located spin-off group (primary + victims): primary
  // emits first, then victims in ascending time order (oldest victim right
  // below the primary, newest last). This mirrors teapot's tip-up stack,
  // where the continuation sits at the base and spin-offs fan out above.
  const coLocatedMembers = new Set<string>();
  if (coLocatedSpinoffPrimaries) {
    for (const [victim, primary] of coLocatedSpinoffPrimaries) {
      coLocatedMembers.add(victim);
      coLocatedMembers.add(primary);
    }
  }

  return [...childRefs].sort((left, right) => {
    const leftInGroup = coLocatedMembers.has(left);
    const rightInGroup = coLocatedMembers.has(right);

    if (leftInGroup && rightInGroup) {
      const leftBranch = branchesByRef.get(left);
      const rightBranch = branchesByRef.get(right);
      const timeOrder =
        getBranchDivergenceTime(leftBranch, commitTimesBySha) -
        getBranchDivergenceTime(rightBranch, commitTimesBySha);
      if (timeOrder !== 0) return timeOrder;
      return left.localeCompare(right);
    }

    return compareBranchRefsForLayout(left, right, branchesByRef, commitTimesBySha);
  });
}

function createLayoutContext(branches: StackBranch[]): LayoutContext {
  const branchesByRef = branchesByRefIndex(branches);
  const commitTimesBySha = commitTimesByShaIndex(branches);
  const {
    additionalRefsByPrimary,
    coPrimaryRefsByPrimary,
    collapsedBranchRefs,
    primaryByCollapsed,
  } = planSameShaCollapse(branches);
  const { pointerBranchRefsByTrunkSha, collapsedPointers } = planPointerBranches(
    branches,
    collapsedBranchRefs
  );
  const trunkForCollapse = branches.find((b) => b.isTrunk);
  for (const ref of collapsedPointers) {
    collapsedBranchRefs.add(ref);
    // Re-parent any descendants of the collapsed pointer onto trunk so they
    // still render. Without this, a topology-inferred child whose parent is
    // the pointer branch would be stranded when the pointer collapses.
    if (trunkForCollapse) {
      primaryByCollapsed.set(ref, trunkForCollapse.ref);
    }
  }
  const { reattachedSpinoffs, coLocatedSpinoffPrimaries, droppedCommitShasByBranch } =
    planSiblingSpinoffs(branches, branchesByRef, commitTimesBySha, collapsedBranchRefs);
  const childRefsByParentAndBase = childRefsByParentAndBaseIndex(
    branches,
    branchesByRef,
    commitTimesBySha,
    primaryByCollapsed,
    reattachedSpinoffs,
    coLocatedSpinoffPrimaries
  );
  const laneByRef = computeLaneByRef(
    branches,
    branchesByRef,
    reattachedSpinoffs,
    coLocatedSpinoffPrimaries
  );

  return {
    branchesByRef,
    commitTimesBySha,
    childRefsByParentAndBase,
    additionalRefsByPrimary,
    coPrimaryRefsByPrimary,
    collapsedBranchRefs,
    primaryByCollapsed,
    reattachedSpinoffs,
    coLocatedSpinoffPrimaries,
    droppedCommitShasByBranch,
    laneByRef,
    pointerBranchRefsByTrunkSha,
  };
}

// A "pointer branch" is a non-trunk branch whose commits are already in
// trunk's history (branch.isMergedIntoTrunk), with its headSha matching an
// inner trunk commit (not trunk's tip — the tip case is covered by
// planSameShaCollapse). These branches have no unique work, so rendering
// them on their own lane looks like a spurious spin-off. Collapsing them
// onto the trunk commit row they point at renders the ref inline with that
// commit, which is what users expect after a fast-forward merge.
//
// Branches merged via squash/rebase (GitHub rewrites the sha) have
// isMergedIntoTrunk=false here because their headSha is not an ancestor of
// trunk; those keep their own row and get a cleanup button at render time.
function planPointerBranches(
  branches: StackBranch[],
  alreadyCollapsed: ReadonlySet<string>
): {
  pointerBranchRefsByTrunkSha: Map<string, string[]>;
  collapsedPointers: Set<string>;
} {
  const pointerBranchRefsByTrunkSha = new Map<string, string[]>();
  const collapsedPointers = new Set<string>();

  const trunk = branches.find((branch) => branch.isTrunk);
  if (!trunk) {
    return { pointerBranchRefsByTrunkSha, collapsedPointers };
  }
  const trunkCommitShas = new Set(trunk.commits.map((commit) => commit.sha));

  for (const branch of branches) {
    if (!branch.isMergedIntoTrunk) continue;
    if (branch.isRemote || branch.isCurrent) continue;
    if (alreadyCollapsed.has(branch.ref)) continue;
    if (branch.headSha === trunk.headSha) continue; // handled by planSameShaCollapse
    if (!trunkCommitShas.has(branch.headSha)) continue; // outside trunk window

    const list = pointerBranchRefsByTrunkSha.get(branch.headSha) ?? [];
    list.push(branch.ref);
    pointerBranchRefsByTrunkSha.set(branch.headSha, list);
    collapsedPointers.add(branch.ref);
  }

  return { pointerBranchRefsByTrunkSha, collapsedPointers };
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
  coLocatedSpinoffPrimaries: Map<string, string>;
  droppedCommitShasByBranch: Map<string, Set<string>>;
} {
  const reattachedSpinoffs = new Map<string, SpinoffAttachment>();
  const coLocatedSpinoffPrimaries = new Map<string, string>();
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

    // Primary = the sibling whose tip was written longest ago. That branch
    // owns the shared spine that reattaching spin-offs curve back to. Kept
    // separate from the display sort (which uses divergence time for
    // stability) because primary status hinges on which sibling is the
    // "oldest settled" one, not on display order.
    const primary = [...group].sort((a, b) => {
      const headOrder =
        getBranchHeadTime(a, commitTimesBySha) - getBranchHeadTime(b, commitTimesBySha);
      if (headOrder !== 0) return headOrder;
      return a.ref.localeCompare(b.ref);
    })[0];
    if (!primary) continue;
    const primaryRef = primary.ref;

    // Per-sibling: count trailing commits that this non-primary shares with
    // the primary, walking both from the tail (oldest-first). When they share
    // commits, the spin-off attaches at the divergence point and the shared
    // commits get dropped so they render once on the primary's spine. When
    // they share none, the spin-off still reattaches at the primary's oldest
    // commit so their relationship reads as a cascade — unless the parent is
    // trunk, where independent peers each draw their own curve back to lane 0
    // and the cascade would hide that peer structure.
    const parentIsTrunk = branchesByRef.get(primary.parentRef ?? '')?.isTrunk ?? false;

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

      if (sharedLength > 0) {
        const sharedShaSet = new Set<string>();
        for (let i = 0; i < sharedLength; i += 1) {
          sharedShaSet.add(primary.commits[primary.commits.length - 1 - i].sha);
        }
        const attachSha = primary.commits[primary.commits.length - sharedLength].sha;
        reattachedSpinoffs.set(branch.ref, { primaryRef, attachSha });
        droppedCommitShasByBranch.set(branch.ref, sharedShaSet);
      } else {
        if (parentIsTrunk) continue;
        // Co-located spin-off: same parent tip, no shared history. Stay as a
        // child of the real parent (so the sort can emit primary → spinoffs
        // top-down under the shared parent's tip row); only the lane is
        // lifted to primaryLane+1 so the spin-off renders to the side.
        coLocatedSpinoffPrimaries.set(branch.ref, primaryRef);
      }
    }
  }

  return { reattachedSpinoffs, coLocatedSpinoffPrimaries, droppedCommitShasByBranch };
}

// Trunk → 0. Natural non-trunk branches → 1. Reattached spin-off siblings →
// primary's lane + 1 (resolved recursively for chains of reattachments).
function computeLaneByRef(
  branches: StackBranch[],
  branchesByRef: Map<string, StackBranch>,
  reattachedSpinoffs: ReadonlyMap<string, SpinoffAttachment>,
  coLocatedSpinoffPrimaries: ReadonlyMap<string, string>
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
      const coLocatedPrimary = coLocatedSpinoffPrimaries.get(ref);
      if (attachment) {
        lane = resolve(attachment.primaryRef) + 1;
      } else if (coLocatedPrimary) {
        lane = resolve(coLocatedPrimary) + 1;
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
  coPrimaryRefsByPrimary: Map<string, string[]>;
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
  const coPrimaryRefsByPrimary = new Map<string, string[]>();
  const collapsedBranchRefs = new Set<string>();
  const primaryByCollapsed = new Map<string, string>();

  for (const group of branchesByHeadSha.values()) {
    if (group.length < 2) {
      continue;
    }

    // Trunk always keeps its own row when present in the group — collapsing
    // it under a non-trunk sibling would hide `main` and, when that sibling
    // is the current branch with no commits of its own, leave the view blank
    // (the trunk row is the spine the rest of the graph hangs off).
    //
    // The current branch (when distinct from trunk) is rendered as a full
    // co-primary label on the same row so the user can always see which ref
    // is checked out. The remaining siblings still collapse into the `+N`
    // overflow badge. When trunk is absent, the current branch becomes the
    // primary and the rest collapse into its badge.
    const trunk = group.find((branch) => branch.isTrunk);
    const currentNonTrunk = group.find(
      (branch) => branch.isCurrent && !branch.isTrunk
    );

    let primary: StackBranch;
    let coPrimary: StackBranch | null = null;
    if (trunk) {
      primary = trunk;
      coPrimary = currentNonTrunk ?? null;
    } else if (currentNonTrunk) {
      primary = currentNonTrunk;
    } else {
      primary = group[0];
    }

    const rest = group.filter(
      (branch) => branch !== primary && branch !== coPrimary
    );
    additionalRefsByPrimary.set(
      primary.ref,
      rest.map((branch) => branch.ref)
    );
    if (coPrimary) {
      coPrimaryRefsByPrimary.set(primary.ref, [coPrimary.ref]);
      collapsedBranchRefs.add(coPrimary.ref);
      primaryByCollapsed.set(coPrimary.ref, primary.ref);
    }
    for (const branch of rest) {
      collapsedBranchRefs.add(branch.ref);
      primaryByCollapsed.set(branch.ref, primary.ref);
    }
  }

  return {
    additionalRefsByPrimary,
    coPrimaryRefsByPrimary,
    collapsedBranchRefs,
    primaryByCollapsed,
  };
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
  reattachedSpinoffs: ReadonlyMap<string, SpinoffAttachment>,
  coLocatedSpinoffPrimaries: ReadonlyMap<string, string>
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
        sortChildRefs(
          childRefs,
          branchesByRef,
          commitTimesBySha,
          coLocatedSpinoffPrimaries
        )
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

  const divergenceOrder =
    getBranchDivergenceTime(right, commitTimesBySha) -
    getBranchDivergenceTime(left, commitTimesBySha);
  if (divergenceOrder !== 0) {
    return divergenceOrder;
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

// Time of the branch's oldest own commit — the divergence point. Unlike head
// or base time, this is frozen once the branch exists: new commits on the tip
// don't shift it, so sorting by it keeps stacks in place as the user works.
function getBranchDivergenceTime(
  branch: StackBranch | undefined,
  commitTimesBySha: ReadonlyMap<string, number>
): number {
  if (!branch) {
    return 0;
  }
  const first = branch.commits[branch.commits.length - 1];
  if (!first) {
    return getBranchBaseTime(branch, commitTimesBySha);
  }
  return commitTimesBySha.get(first.sha) ?? first.timeMs ?? 0;
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
