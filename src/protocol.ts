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
}

export interface StackBranch {
  ref: string;
  headSha: string;
  baseSha: string;
  parentRef: string | null;
  childRefs: string[];
  ownedShas: string[];
  commits: Commit[];
  isTrunk: boolean;
  isRemote: boolean;
  isCurrent: boolean;
  worktreePath: string | null;
  worktreePeacockColor: string | null;
  pullRequest: PullRequestInfo | null;
}

export interface RebaseIntentNode {
  branchRef: string;
  headSha: string;
  baseSha: string;
  ownedShas: string[];
  children: RebaseIntentNode[];
}

export interface RebaseIntent {
  root: RebaseIntentNode;
  targetBaseSha: string;
  targetBranchRef: string | null;
}

export interface StackState {
  branches: StackBranch[];
  trunk: string | null;
  current: string | null;
  repoRoot: string | null;
  error: string | null;
  pendingRebase: RebaseIntent | null;
}

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
  | { type: 'checkoutBranch'; branchRef: string }
  | { type: 'forcePushBranch'; branchRef: string }
  | { type: 'createPullRequest'; branchRef: string };
