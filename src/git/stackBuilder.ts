import type { StackBranch, StackState } from '../protocol';
import { GitClient, type LocalBranchHead } from './gitClient';
import { selectTrunk } from './trunk';

const DEFAULT_TRUNK_COMMIT_LIMIT = 200;
const BRANCH_COMMIT_LIMIT = 200;

interface ParentCandidate {
  name: string;
  distance: number;
}

interface ResolvedBranchTopology {
  branch: LocalBranchHead;
  parentRef: string | null;
  parentHeadSha: string | null;
  baseSha: string;
}

interface GitStackQueries {
  mergeBase(left: string, right: string): Promise<string | null>;
  countCommits(fromRef: string, toRef: string): Promise<number>;
}

export class GitStackBuilder {
  static async build(cwd: string): Promise<StackState> {
    const git = await GitClient.open(cwd);
    if (!git) {
      return createErrorState('Not a git repository');
    }

    const repoRoot = git.getRepoRoot();

    try {
      const [branches, current] = await Promise.all([
        git.listLocalBranches(),
        git.getCurrentBranch(),
      ]);
      const queries = createGitStackQueries(git);
      const trunk = selectTrunk(branches.map((branch) => branch.name));
      const topology = await resolveBranchTopology(queries, branches, trunk);
      const childRefs = buildChildIndex(topology);
      const trunkCommitLimit = await determineTrunkCommitLimit(queries, topology, trunk);

      const stackBranches = await Promise.all(
        topology.map(async ({ branch, parentRef, parentHeadSha, baseSha }) => {
          return createStackBranch({
            git,
            branch,
            baseSha,
            parentRef,
            parentHeadSha,
            childRefs: childRefs.get(branch.name) ?? [],
            current,
            trunk,
            trunkCommitLimit,
          });
        })
      );

      return {
        branches: stackBranches,
        trunk,
        current,
        repoRoot,
        error: null,
      };
    } catch (error) {
      return {
        ...createErrorState(toErrorMessage(error)),
        repoRoot,
      };
    }
  }
}

async function createStackBranch(params: {
  git: GitClient;
  branch: LocalBranchHead;
  baseSha: string;
  parentRef: string | null;
  parentHeadSha: string | null;
  childRefs: string[];
  current: string | null;
  trunk: string | null;
  trunkCommitLimit: number;
}): Promise<StackBranch> {
  const {
    git,
    branch,
    baseSha,
    parentRef,
    parentHeadSha,
    childRefs,
    current,
    trunk,
    trunkCommitLimit,
  } = params;
  const isTrunk = branch.name === trunk;

  const commits = await git.getCommits({
    fromRef: isTrunk ? null : parentHeadSha,
    toRef: branch.headSha,
    limit: isTrunk ? trunkCommitLimit : BRANCH_COMMIT_LIMIT,
  });

  return {
    ref: branch.name,
    headSha: branch.headSha,
    baseSha,
    parentRef,
    childRefs: [...childRefs],
    ownedShas: commits.map((commit) => commit.sha),
    commits,
    isTrunk,
    isRemote: false,
    isCurrent: branch.name === current,
  };
}

async function resolveBranchTopology(
  queries: GitStackQueries,
  branches: LocalBranchHead[],
  trunk: string | null
): Promise<ResolvedBranchTopology[]> {
  const branchHeadsByName = new Map(branches.map((branch) => [branch.name, branch.headSha]));
  const parentRefs = await buildParentIndex(queries, branches, trunk);

  return Promise.all(
    branches.map(async (branch) => {
      const parentRef = parentRefs.get(branch.name) ?? null;
      const parentHeadSha = parentRef ? branchHeadsByName.get(parentRef) ?? null : null;

      return {
        branch,
        parentRef,
        parentHeadSha,
        baseSha: await resolveBaseSha(queries, branch.headSha, parentHeadSha),
      };
    })
  );
}

async function buildParentIndex(
  queries: GitStackQueries,
  branches: LocalBranchHead[],
  trunk: string | null
): Promise<Map<string, string | null>> {
  const parentRefs = new Map<string, string | null>();

  await Promise.all(
    branches.map(async (branch) => {
      if (branch.name === trunk) {
        parentRefs.set(branch.name, null);
        return;
      }

      parentRefs.set(branch.name, await inferParentRef(queries, branch, branches, trunk));
    })
  );

  return parentRefs;
}

function buildChildIndex(
  topology: ResolvedBranchTopology[]
): Map<string, string[]> {
  const childRefs = new Map<string, string[]>();

  for (const { branch } of topology) {
    childRefs.set(branch.name, []);
  }

  for (const { branch, parentRef } of topology) {
    if (parentRef && childRefs.has(parentRef)) {
      childRefs.get(parentRef)?.push(branch.name);
    }
  }

  for (const children of childRefs.values()) {
    children.sort((left, right) => left.localeCompare(right));
  }

  return childRefs;
}

async function determineTrunkCommitLimit(
  queries: GitStackQueries,
  topology: ResolvedBranchTopology[],
  trunk: string | null
): Promise<number> {
  const trunkBranch = topology.find(({ branch }) => branch.name === trunk);
  if (!trunkBranch) {
    return DEFAULT_TRUNK_COMMIT_LIMIT;
  }

  const directChildren = topology.filter(({ parentRef }) => parentRef === trunk);
  if (directChildren.length === 0) {
    return DEFAULT_TRUNK_COMMIT_LIMIT;
  }

  const commitDepths = await Promise.all(
    directChildren.map(async ({ baseSha }) => {
      const commitsAhead = await queries.countCommits(baseSha, trunkBranch.branch.headSha);
      return commitsAhead + 1;
    })
  );

  // Load enough of trunk to keep every direct branch attachment point available
  // to the layout algorithm, while still using a sensible minimum for smaller repos.
  return Math.max(DEFAULT_TRUNK_COMMIT_LIMIT, ...commitDepths);
}

async function inferParentRef(
  queries: GitStackQueries,
  target: LocalBranchHead,
  candidates: LocalBranchHead[],
  trunk: string | null
): Promise<string | null> {
  let bestCandidate: ParentCandidate | null = null;

  for (const candidate of candidates) {
    if (candidate.name === target.name) {
      continue;
    }

    const mergeBase = await queries.mergeBase(target.headSha, candidate.headSha);
    if (!mergeBase || mergeBase !== candidate.headSha) {
      continue;
    }

    const distance = await queries.countCommits(candidate.headSha, target.headSha);
    if (distance === 0) {
      continue;
    }

    if (!bestCandidate || distance < bestCandidate.distance) {
      bestCandidate = { name: candidate.name, distance };
    }
  }

  if (bestCandidate) {
    return bestCandidate.name;
  }

  return trunk && trunk !== target.name ? trunk : null;
}

async function resolveBaseSha(
  queries: GitStackQueries,
  headSha: string,
  parentHeadSha: string | null
): Promise<string> {
  if (!parentHeadSha) {
    return headSha;
  }

  return (await queries.mergeBase(headSha, parentHeadSha)) ?? parentHeadSha;
}

function createErrorState(error: string): StackState {
  return {
    branches: [],
    trunk: null,
    current: null,
    repoRoot: null,
    error,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createGitStackQueries(git: GitClient): GitStackQueries {
  const mergeBaseCache = new Map<string, Promise<string | null>>();
  const commitCountCache = new Map<string, Promise<number>>();

  return {
    mergeBase(left: string, right: string): Promise<string | null> {
      return getOrCreateCachedValue(mergeBaseCache, `${left}::${right}`, () =>
        git.mergeBase(left, right)
      );
    },
    countCommits(fromRef: string, toRef: string): Promise<number> {
      return getOrCreateCachedValue(commitCountCache, `${fromRef}..${toRef}`, () =>
        git.countCommits(fromRef, toRef)
      );
    },
  };
}

function getOrCreateCachedValue<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  createValue: () => Promise<T>
): Promise<T> {
  const existingValue = cache.get(key);
  if (existingValue) {
    return existingValue;
  }

  const nextValue = createValue();
  cache.set(key, nextValue);
  return nextValue;
}
