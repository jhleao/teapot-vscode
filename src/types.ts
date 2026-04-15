/**
 * Commit shape aligned with teapot's shared/types/repo Commit.
 * `message` holds the commit subject (first line of the full message).
 */
export interface Commit {
  sha: string;
  message: string;
  author: string;
  timeMs: number;
  parentSha: string;
}

/**
 * Branch shape aligned with teapot's Branch (ref, headSha, isTrunk, isRemote).
 * Extended with parent/children/commits for rendering convenience (MVP keeps
 * things flat rather than mirroring StackNodeState's recursive tree).
 */
export interface BranchNode {
  ref: string;
  headSha: string;
  baseSha: string;
  isTrunk: boolean;
  isRemote: boolean;
  isCurrent: boolean;
  parent: string | null;
  children: string[];
  ownedShas: string[];
  commits: Commit[];
}

export interface StackState {
  branches: BranchNode[];
  trunk: string | null;
  current: string | null;
  repoRoot: string | null;
  error: string | null;
}

export type HostToWebview =
  | { type: 'stack'; state: StackState };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' };
