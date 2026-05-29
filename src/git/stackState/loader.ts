import type { ActiveRebaseState, StackBranch, StackState } from '../../protocol';
import { GitClient, type LocalBranchHead } from '../gitClient';
import { OperationQueueStore } from '../../rebase/queueStore';
import { selectTrunk } from '../trunk';
import { normalizeWorktreePath, readAttentionWorktreePaths } from './agentAttention';
import {
  buildChildRefsByParent,
  determineTrunkCommitLimit,
  resolveBranchTopology,
} from './topology';
import {
  buildPeacockColorByWorktreePath,
  buildWorktreePathByBranchRef,
  buildWorktreePathByBranchRefIncludingMain,
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
      const [
        { branches, currentBranch: currentBranchRef },
        worktrees,
        hasUncommittedChanges,
        attentionPaths,
      ] = await Promise.all([
        git.listLocalBranchesSnapshot(),
        git.listWorktrees(),
        git.hasAnyChanges(),
        readAgentAttention(git),
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
      const attentionWorktreePathByBranchRef =
        buildWorktreePathByBranchRefIncludingMain(worktrees);
      const peacockColorByWorktreePath = await buildPeacockColorByWorktreePath(
        worktreePathByBranchRef
      );

      const trunkHeadSha =
        topology.find(({ branch }) => branch.name === trunkRef)?.branch.headSha ?? null;

      const stackBranches = await Promise.all(
        topology.map(async ({ branch, parentRef, parentHeadSha, baseSha }) => {
          const worktreePath = worktreePathByBranchRef.get(branch.name) ?? null;
          const isTrunk = branch.name === trunkRef;
          const isMergedIntoTrunk =
            !isTrunk && !!trunkHeadSha && (await git.isAncestor(branch.headSha, trunkHeadSha));

          return createStackBranch({
            git,
            branch,
            baseSha,
            parentRef,
            parentHeadSha,
            childRefs: childRefsByParent.get(branch.name) ?? [],
            currentBranchRef,
            hasUncommittedChanges,
            trunkRef,
            trunkCommitLimit,
            worktreePath,
            worktreePeacockColor: worktreePath
              ? peacockColorByWorktreePath.get(worktreePath) ?? null
              : null,
            needsAttention: branchNeedsAttention(
              attentionWorktreePathByBranchRef.get(branch.name) ?? null,
              attentionPaths
            ),
            isMergedIntoTrunk,
          });
        })
      );

      const activeRebase = await buildActiveRebaseState(
        git,
        new OperationQueueStore(repoRoot)
      );

      return {
        branches: stackBranches,
        trunk: trunkRef,
        current: currentBranchRef,
        repoRoot,
        error: null,
        pendingRebase: null,
        activeRebase,
      };
    } catch (error) {
      return {
        ...createErrorState(toErrorMessage(error)),
        repoRoot,
      };
    }
  }
}

async function buildActiveRebaseState(
  git: GitClient,
  store: OperationQueueStore
): Promise<ActiveRebaseState | null> {
  const [pausedRebase, queue] = await Promise.all([git.hasPausedRebase(), store.load()]);
  if (!pausedRebase) {
    return null;
  }

  const nextStep =
    queue && queue.cursor < queue.steps.length ? queue.steps[queue.cursor] : null;

  return {
    gitInProgress: true,
    queued: queue !== null,
    pendingStepCount: queue
      ? Math.max(queue.steps.length - queue.cursor - 1, 0)
      : 0,
    currentStep:
      nextStep?.kind === 'rebase-branch'
        ? { branchRef: nextStep.branchRef, label: `Rebasing ${nextStep.branchRef}` }
        : null,
    headBranchRef: await git.readRebaseMergeHeadName(),
  };
}

async function createStackBranch(params: {
  git: GitClient;
  branch: LocalBranchHead;
  baseSha: string;
  parentRef: string | null;
  parentHeadSha: string | null;
  childRefs: string[];
  currentBranchRef: string | null;
  hasUncommittedChanges: boolean;
  trunkRef: string | null;
  trunkCommitLimit: number;
  worktreePath: string | null;
  worktreePeacockColor: string | null;
  needsAttention: boolean;
  isMergedIntoTrunk: boolean;
}): Promise<StackBranch> {
  const {
    git,
    branch,
    baseSha,
    parentRef,
    parentHeadSha,
    childRefs,
    currentBranchRef,
    hasUncommittedChanges,
    trunkRef,
    trunkCommitLimit,
    worktreePath,
    worktreePeacockColor,
    needsAttention,
    isMergedIntoTrunk,
  } = params;
  const isCurrent = branch.name === currentBranchRef;
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
    commits,
    isTrunk,
    isRemote: false,
    isCurrent,
    hasUncommittedChanges: isCurrent && hasUncommittedChanges,
    worktreePath,
    worktreePeacockColor,
    needsAttention,
    pullRequest: null,
    isMergedIntoTrunk,
  };
}

function branchNeedsAttention(
  worktreePath: string | null,
  attentionPaths: Set<string>
): boolean {
  if (!worktreePath) {
    return false;
  }
  return attentionPaths.has(normalizeWorktreePath(worktreePath));
}

async function readAgentAttention(git: GitClient): Promise<Set<string>> {
  try {
    const commonGitDir = await git.getCommonGitDir();
    return await readAttentionWorktreePaths(commonGitDir);
  } catch {
    return new Set();
  }
}

function createErrorState(error: string): StackState {
  return {
    branches: [],
    trunk: null,
    current: null,
    repoRoot: null,
    error,
    pendingRebase: null,
    activeRebase: null,
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
