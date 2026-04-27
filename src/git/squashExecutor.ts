import type { GitClient } from './gitClient';
import type { SquashPlan } from './squashPlanner';

export type SquashBranchChoice = 'parent' | 'child';

export interface SquashExecuteOptions {
  plan: SquashPlan;
  message: string;
  branchChoice: SquashBranchChoice;
}

export interface SquashExecuteResult {
  newCommitSha: string;
  keptBranch: string;
  deletedBranch: string;
}

export class SquashExecutorUtils {
  static async run(
    git: GitClient,
    { plan, message, branchChoice }: SquashExecuteOptions
  ): Promise<SquashExecuteResult> {
    const originalParentSha = plan.parentHeadSha;
    const originalChildSha = plan.childHeadSha;
    const originalBranch = await git.getCurrentBranch();

    // Step 1: move onto parent. If that fails, nothing has changed.
    await git.checkout(plan.parentRef);

    let parentAmended = false;

    try {
      if (!plan.isEmpty) {
        const range = `${originalParentSha}..${originalChildSha}`;
        const patch = await git.formatPatchRange(range);
        if (patch.trim().length > 0) {
          await git.applyPatch(patch, { check: true });
          await git.applyPatch(patch);
          await git.stageAll();

          const author = await git.getCommitAuthor(originalChildSha);
          await git.amendWithMessageAndAuthor({
            message,
            authorName: author?.name,
            authorEmail: author?.email,
          });
          parentAmended = true;
        }
      }

      // Empty squash: only amend if the user picked a different message than
      // parent already has (e.g. "Keep child" adopts child's message). Skipping
      // when the message is unchanged avoids a pointless committer-date bump.
      if (!parentAmended) {
        const currentParentMessage = plan.newCommitMessageByChoice.parent;
        if (message !== currentParentMessage) {
          await git.amendCommitMessage(message);
        }
      }

      const newCommitSha = await git.revParse('HEAD');

      if (branchChoice === 'parent') {
        await git.deleteBranch(plan.branchRef);
        return {
          newCommitSha,
          keptBranch: plan.parentRef,
          deletedBranch: plan.branchRef,
        };
      }

      // branchChoice === 'child': move child to new SHA, switch to it, delete parent.
      await git.createOrMoveBranch(plan.branchRef, newCommitSha);
      await git.checkout(plan.branchRef);
      await git.deleteBranch(plan.parentRef);
      return {
        newCommitSha,
        keptBranch: plan.branchRef,
        deletedBranch: plan.parentRef,
      };
    } catch (error) {
      await rollback(git, {
        parentRef: plan.parentRef,
        originalParentSha,
        originalBranch,
      });
      throw error;
    }
  }
}

async function rollback(
  git: GitClient,
  opts: { parentRef: string; originalParentSha: string; originalBranch: string | null }
): Promise<void> {
  try {
    // We're on the parent branch (or detached). Reset it back to where it was.
    await git.resetHard(opts.originalParentSha);
  } catch {
    // best-effort
  }
  if (opts.originalBranch && opts.originalBranch !== opts.parentRef) {
    try {
      await git.checkout(opts.originalBranch);
    } catch {
      // best-effort
    }
  }
}
