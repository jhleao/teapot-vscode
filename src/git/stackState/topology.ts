import type { GitClient, LocalBranchHead } from '../gitClient';

export interface ResolvedBranchTopology {
  branch: LocalBranchHead;
  parentRef: string | null;
  parentHeadSha: string | null;
  baseSha: string;
}

interface ParentCandidate {
  ref: string;
  distance: number;
}

interface ParentResolution {
  parentRef: string | null;
  fromAncestorWalk: boolean;
}

export async function resolveBranchTopology(
  git: GitClient,
  branches: LocalBranchHead[],
  trunkRef: string | null
): Promise<ResolvedBranchTopology[]> {
  const parentResolutionByBranchRef = await inferParentRefs(git, branches, trunkRef);
  const branchHeadShaByRef = new Map(branches.map((branch) => [branch.name, branch.headSha]));

  return Promise.all(
    branches.map(async (branch) => {
      const parentResolution = parentResolutionByBranchRef.get(branch.name) ?? {
        parentRef: null,
        fromAncestorWalk: false,
      };
      const parentHeadSha = parentResolution.parentRef
        ? branchHeadShaByRef.get(parentResolution.parentRef) ?? null
        : null;

      return {
        branch,
        parentRef: parentResolution.parentRef,
        parentHeadSha,
        baseSha: await resolveBaseSha(
          git,
          branch.headSha,
          parentHeadSha,
          parentResolution.fromAncestorWalk
        ),
      };
    })
  );
}

export function buildChildRefsByParent(
  topology: ResolvedBranchTopology[]
): Map<string, string[]> {
  const childRefsByParent = new Map<string, string[]>();

  for (const { branch } of topology) {
    childRefsByParent.set(branch.name, []);
  }

  for (const { branch, parentRef } of topology) {
    if (!parentRef) {
      continue;
    }

    childRefsByParent.get(parentRef)?.push(branch.name);
  }

  for (const childRefs of childRefsByParent.values()) {
    childRefs.sort((left, right) => left.localeCompare(right));
  }

  return childRefsByParent;
}

export async function determineTrunkCommitLimit(
  git: GitClient,
  topology: ResolvedBranchTopology[],
  trunkRef: string | null,
  defaultLimit: number
): Promise<number> {
  const trunkBranch = topology.find(({ branch }) => branch.name === trunkRef);
  if (!trunkBranch) {
    return defaultLimit;
  }

  const directChildren = topology.filter(({ parentRef }) => parentRef === trunkRef);
  if (directChildren.length === 0) {
    return defaultLimit;
  }

  const commitDepths = await Promise.all(
    directChildren.map(async ({ baseSha }) => {
      const commitsAhead = await git.countCommits(baseSha, trunkBranch.branch.headSha);
      return commitsAhead + 1;
    })
  );

  return Math.max(defaultLimit, ...commitDepths);
}

async function inferParentRefs(
  git: GitClient,
  branches: LocalBranchHead[],
  trunkRef: string | null
): Promise<Map<string, ParentResolution>> {
  const parentResolutionByBranchRef = new Map<string, ParentResolution>();
  const branchRefsByHeadSha = indexBranchRefsByHeadSha(branches);
  const nearestAncestorByCommitSha = await inferNearestAncestorBranches(
    git,
    branches,
    branchRefsByHeadSha,
    trunkRef
  );

  for (const branch of branches) {
    if (branch.name === trunkRef) {
      parentResolutionByBranchRef.set(branch.name, {
        parentRef: null,
        fromAncestorWalk: false,
      });
      continue;
    }

    const inferredParentRef = nearestAncestorByCommitSha.get(branch.headSha)?.ref ?? null;
    parentResolutionByBranchRef.set(branch.name, {
      parentRef: inferredParentRef ?? (trunkRef && trunkRef !== branch.name ? trunkRef : null),
      fromAncestorWalk: inferredParentRef !== null,
    });
  }

  return parentResolutionByBranchRef;
}

async function inferNearestAncestorBranches(
  git: GitClient,
  branches: LocalBranchHead[],
  branchRefsByHeadSha: ReadonlyMap<string, string[]>,
  trunkRef: string | null
): Promise<Map<string, ParentCandidate>> {
  const headShas = [...new Set(branches.map((branch) => branch.headSha))];
  const topologyEntries = await git.listCommitTopology(headShas);
  const parentShasByCommitSha = new Map(
    topologyEntries.map(({ sha, parentShas }) => [sha, parentShas] as const)
  );
  const nearestAncestorByCommitSha = new Map<string, ParentCandidate>();

  for (let index = topologyEntries.length - 1; index >= 0; index -= 1) {
    const { sha } = topologyEntries[index];
    const parentShas = parentShasByCommitSha.get(sha) ?? [];
    const bestCandidate = inferBestParentCandidate(
      parentShas,
      branchRefsByHeadSha,
      nearestAncestorByCommitSha,
      trunkRef
    );

    if (bestCandidate) {
      nearestAncestorByCommitSha.set(sha, bestCandidate);
    }
  }

  return nearestAncestorByCommitSha;
}

function inferBestParentCandidate(
  parentShas: string[],
  branchRefsByHeadSha: ReadonlyMap<string, string[]>,
  nearestAncestorByCommitSha: ReadonlyMap<string, ParentCandidate>,
  trunkRef: string | null
): ParentCandidate | null {
  let bestCandidate: ParentCandidate | null = null;

  for (const parentSha of parentShas) {
    const directAncestorRefs = branchRefsByHeadSha.get(parentSha) ?? [];
    for (const ref of directAncestorRefs) {
      bestCandidate = pickPreferredParentCandidate(
        bestCandidate,
        { ref, distance: 1 },
        trunkRef
      );
    }

    const propagatedCandidate = nearestAncestorByCommitSha.get(parentSha);
    if (!propagatedCandidate) {
      continue;
    }

    bestCandidate = pickPreferredParentCandidate(
      bestCandidate,
      {
        ref: propagatedCandidate.ref,
        distance: propagatedCandidate.distance + 1,
      },
      trunkRef
    );
  }

  return bestCandidate;
}

function pickPreferredParentCandidate(
  current: ParentCandidate | null,
  candidate: ParentCandidate,
  trunkRef: string | null
): ParentCandidate {
  if (!current) {
    return candidate;
  }

  const distanceOrder = candidate.distance - current.distance;
  if (distanceOrder !== 0) {
    return distanceOrder < 0 ? candidate : current;
  }

  const trunkOrder = Number(candidate.ref === trunkRef) - Number(current.ref === trunkRef);
  if (trunkOrder !== 0) {
    return trunkOrder > 0 ? candidate : current;
  }

  return candidate.ref.localeCompare(current.ref) < 0 ? candidate : current;
}

function indexBranchRefsByHeadSha(
  branches: LocalBranchHead[]
): Map<string, string[]> {
  const branchRefsByHeadSha = new Map<string, string[]>();

  for (const branch of branches) {
    const refs = branchRefsByHeadSha.get(branch.headSha) ?? [];
    refs.push(branch.name);
    branchRefsByHeadSha.set(branch.headSha, refs);
  }

  for (const refs of branchRefsByHeadSha.values()) {
    refs.sort((left, right) => left.localeCompare(right));
  }

  return branchRefsByHeadSha;
}

async function resolveBaseSha(
  git: GitClient,
  headSha: string,
  parentHeadSha: string | null,
  parentWasInferredFromAncestry: boolean
): Promise<string> {
  if (!parentHeadSha) {
    return headSha;
  }

  if (parentWasInferredFromAncestry) {
    return parentHeadSha;
  }

  return (await git.mergeBase(headSha, parentHeadSha)) ?? parentHeadSha;
}
