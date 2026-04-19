export interface Commit {
  sha: string;
  message: string;
  author: string;
  timeMs: number;
  parentSha: string;
}

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';

export interface PullRequestInfo {
  number: number;
  url: string;
  state: PullRequestState;
  // Only meaningful for open/draft; always true for merged/closed.
  isInSync: boolean;
  // PR's current base branch on GitHub (bare ref, e.g. "main").
  baseRef: string;
}

export type GitHubPendingOpKind = 'push' | 'create-pr' | 'pull-trunk';

export interface GitHubPendingOp {
  branchRef: string;
  kind: GitHubPendingOpKind;
}

export interface GitHubActivity {
  isFetching: boolean;
  pendingOps: GitHubPendingOp[];
}

export interface StackBranch {
  ref: string;
  headSha: string;
  baseSha: string;
  parentRef: string | null;
  childRefs: string[];
  commits: Commit[];
  isTrunk: boolean;
  isRemote: boolean;
  isCurrent: boolean;
  hasUncommittedChanges: boolean;
  worktreePath: string | null;
  worktreePeacockColor: string | null;
  pullRequest: PullRequestInfo | null;
  // True iff this branch's headSha is an ancestor of trunk's headSha — i.e.
  // its commits are already in trunk's history (fast-forward merge case).
  // Squash/rebase merges do NOT set this; detect those via pullRequest.state.
  isMergedIntoTrunk: boolean;
}

export interface RebaseIntentNode {
  branchRef: string;
  headSha: string;
  baseSha: string;
  children: RebaseIntentNode[];
}

export interface RebaseIntent {
  root: RebaseIntentNode;
  targetBaseSha: string;
  targetBranchRef: string | null;
}

export type TargetBase =
  | { kind: 'sha'; sha: string }
  | { kind: 'ref'; ref: string }
  | { kind: 'completed-step-head'; stepId: string };

export type QueuedStep =
  | {
      kind: 'rebase-branch';
      id: string;
      branchRef: string;
      upstreamSha: string;
      preRebaseHeadSha: string;
      targetBase: TargetBase;
    }
  | {
      kind: 'restore-head';
      id: string;
      branchRef: string | null;
    };

export interface OperationQueue {
  schemaVersion: 1;
  createdAtMs: number;
  repoRoot: string;
  originalBranchRef: string | null;
  steps: QueuedStep[];
  cursor: number;
  completedHeads: Record<string, string>;
  label: string;
}

export interface ActiveRebaseState {
  gitInProgress: boolean;
  queued: boolean;
  pendingStepCount: number;
  currentStep: { branchRef: string; label: string } | null;
  headBranchRef: string | null;
}

export interface StackState {
  branches: StackBranch[];
  trunk: string | null;
  current: string | null;
  repoRoot: string | null;
  error: string | null;
  pendingRebase: RebaseIntent | null;
  activeRebase: ActiveRebaseState | null;
  githubActivity?: GitHubActivity;
}

export const EMPTY_GITHUB_ACTIVITY: GitHubActivity = Object.freeze({
  isFetching: false,
  pendingOps: [] as GitHubPendingOp[],
}) as GitHubActivity;

export type HostToWebviewMessage = {
  type: 'stack';
  state: StackState;
};

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'submitRebaseIntent'; intent: RebaseIntent }
  | { type: 'confirmRebaseIntent' }
  | { type: 'cancelRebaseIntent' }
  | { type: 'continueRebase' }
  | { type: 'abortRebase' }
  | { type: 'checkoutBranch'; branchRef: string }
  | { type: 'deleteBranch'; branchRef: string }
  | { type: 'pickBranchAction'; branchRefs: string[] }
  | { type: 'forcePushBranch'; branchRef: string }
  | { type: 'createPullRequest'; branchRef: string }
  | { type: 'createBranchAtCommit'; commitSha: string }
  | { type: 'amendAndRebase'; stageAll?: boolean }
  | { type: 'branchAndCommit'; stageAll?: boolean }
  | { type: 'pullTrunk' };
