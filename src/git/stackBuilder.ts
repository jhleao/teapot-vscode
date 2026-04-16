import type { StackBranch, StackState } from '../protocol';
import { GitClient, type LocalBranchHead } from './gitClient';
import { selectTrunk } from './trunk';

interface ParentCandidate {
  name: string;
  distance: number;
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
      const branchHeadsByName = new Map(branches.map((branch) => [branch.name, branch.headSha]));
      const trunk = selectTrunk(branches.map((branch) => branch.name));
      const parentRefs = await buildParentIndex(queries, branches, trunk);
      const childRefs = buildChildIndex(branches, parentRefs);

      const stackBranches = await Promise.all(
        branches.map(async (branch) => {
          const parentRef = parentRefs.get(branch.name) ?? null;
          const parentHeadSha = parentRef ? branchHeadsByName.get(parentRef) ?? null : null;

          return createStackBranch({
            git,
            queries,
            branch,
            parentRef,
            parentHeadSha,
            childRefs: childRefs.get(branch.name) ?? [],
            current,
            trunk,
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
  queries: GitStackQueries;
  branch: LocalBranchHead;
  parentRef: string | null;
  parentHeadSha: string | null;
  childRefs: string[];
  current: string | null;
  trunk: string | null;
}): Promise<StackBranch> {
  const { git, queries, branch, parentRef, parentHeadSha, childRefs, current, trunk } = params;
  const isTrunk = branch.name === trunk;

  const [baseSha, commits] = await Promise.all([
    resolveBaseSha(queries, branch.headSha, parentHeadSha),
    git.getCommits({
      fromRef: isTrunk ? null : parentHeadSha,
      toRef: branch.headSha,
      limit: isTrunk ? 5 : 200,
    }),
  ]);

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
  branches: LocalBranchHead[],
  parentRefs: Map<string, string | null>
): Map<string, string[]> {
  const childRefs = new Map<string, string[]>();

  for (const branch of branches) {
    childRefs.set(branch.name, []);
  }

  for (const branch of branches) {
    const parentRef = parentRefs.get(branch.name);
    if (parentRef && childRefs.has(parentRef)) {
      childRefs.get(parentRef)?.push(branch.name);
    }
  }

  for (const children of childRefs.values()) {
    children.sort((left, right) => left.localeCompare(right));
  }

  return childRefs;
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
