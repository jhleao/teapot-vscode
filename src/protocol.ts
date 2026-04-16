export interface Commit {
  sha: string;
  message: string;
  author: string;
  timeMs: number;
  parentSha: string;
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
  | { type: 'cancelRebaseIntent' };
