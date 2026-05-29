import type { WorktreeInfo } from '../gitClient';
import { PeacockColorUtils } from '../peacockColor';

export async function buildPeacockColorByWorktreePath(
  worktreePathByBranchRef: ReadonlyMap<string, string>
): Promise<Map<string, string | null>> {
  const uniquePaths = new Set(worktreePathByBranchRef.values());
  const entries = await Promise.all(
    [...uniquePaths].map(async (worktreePath) => {
      return [worktreePath, await PeacockColorUtils.readForWorktree(worktreePath)] as const;
    })
  );

  return new Map(entries);
}

export function buildWorktreePathByBranchRef(
  worktrees: WorktreeInfo[],
  repoRoot: string
): Map<string, string> {
  const worktreePathByBranchRef = new Map<string, string>();

  for (const worktree of worktrees) {
    if (!worktree.branch || worktree.path === repoRoot) {
      continue;
    }

    if (!worktreePathByBranchRef.has(worktree.branch)) {
      worktreePathByBranchRef.set(worktree.branch, worktree.path);
    }
  }

  return worktreePathByBranchRef;
}

// Like buildWorktreePathByBranchRef, but also includes the main checkout. The
// agent-attention signal needs the main checkout's branch mapped to its path
// so the dot can light up the currently-open window's own row; the display
// map deliberately excludes it to avoid a redundant worktree badge on the
// branch you're already inside.
export function buildWorktreePathByBranchRefIncludingMain(
  worktrees: WorktreeInfo[]
): Map<string, string> {
  const byBranch = new Map<string, string>();

  for (const worktree of worktrees) {
    if (!worktree.branch) {
      continue;
    }
    if (!byBranch.has(worktree.branch)) {
      byBranch.set(worktree.branch, worktree.path);
    }
  }

  return byBranch;
}
