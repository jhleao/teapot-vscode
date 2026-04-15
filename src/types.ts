export interface Commit {
  sha: string;
  subject: string;
  author: string;
  timeMs: number;
}

export interface BranchNode {
  name: string;
  headSha: string;
  parent: string | null;
  isTrunk: boolean;
  isCurrent: boolean;
  commits: Commit[];
  children: string[];
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
