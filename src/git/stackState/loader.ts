import type { StackBranch, StackState } from '../../protocol';
import { GitClient, type LocalBranchHead } from '../gitClient';
import { selectTrunk } from '../trunk';
import {
  buildChildRefsByParent,
  determineTrunkCommitLimit,
  resolveBranchTopology,
} from './topology';
import {
  buildPeacockColorByWorktreePath,
  buildWorktreePathByBranchRef,
} from './worktrees';

const DEFAULT_TRUNK_COMMIT_LIMIT = 200;
const BRANCH_COMMIT_LIMIT = 200;

export class GitStackStateLoader {
  static async load(cwd: string): Promise<StackState> {
    const git = await GitClient.open(cwd);
    if (!git) {
      return createErrorState('Not a git repository');
    }

    const repoRoot = git.getRepoRoot();

    try {
      const [{ branches, currentBranch: currentBranchRef }, worktrees] = await Promise.all([
        git.listLocalBranchesSnapshot(),
        git.listWorktrees(),
      ]);
      const trunkRef = selectTrunk(iterBranchNames(branches));
      const topology = await resolveBranchTopology(git, branches, trunkRef);
      const childRefsByParent = buildChildRefsByParent(topology);
      const trunkCommitLimit = await determineTrunkCommitLimit(
        git,
        topology,
        trunkRef,
        DEFAULT_TRUNK_COMMIT_LIMIT
      );
      const worktreePathByBranchRef = buildWorktreePathByBranchRef(worktrees, repoRoot);
      const peacockColorByWorktreePath = await buildPeacockColorByWorktreePath(
        worktreePathByBranchRef
      );

      const stackBranches = await Promise.all(
        topology.map(async ({ branch, parentRef, parentHeadSha, baseSha }) => {
          const worktreePath = worktreePathByBranchRef.get(branch.name) ?? null;

          return createStackBranch({
            git,
            branch,
            baseSha,
            parentRef,
            parentHeadSha,
            childRefs: childRefsByParent.get(branch.name) ?? [],
            currentBranchRef,
            trunkRef,
            trunkCommitLimit,
            worktreePath,
            worktreePeacockColor: worktreePath
              ? peacockColorByWorktreePath.get(worktreePath) ?? null
              : null,
          });
        })
      );

      return {
        branches: stackBranches,
        trunk: trunkRef,
        current: currentBranchRef,
        repoRoot,
        error: null,
        pendingRebase: null,
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
  currentBranchRef: string | null;
  trunkRef: string | null;
  trunkCommitLimit: number;
  worktreePath: string | null;
  worktreePeacockColor: string | null;
}): Promise<StackBranch> {
  const {
    git,
    branch,
    baseSha,
    parentRef,
    parentHeadSha,
    childRefs,
    currentBranchRef,
    trunkRef,
    trunkCommitLimit,
    worktreePath,
    worktreePeacockColor,
  } = params;
  const isTrunk = branch.name === trunkRef;
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
    isCurrent: branch.name === currentBranchRef,
    worktreePath,
    worktreePeacockColor,
    pullRequest: null,
  };
}

function createErrorState(error: string): StackState {
  return {
    branches: [],
    trunk: null,
    current: null,
    repoRoot: null,
    error,
    pendingRebase: null,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function* iterBranchNames(branches: LocalBranchHead[]): Iterable<string> {
  for (const branch of branches) {
    yield branch.name;
  }
}
