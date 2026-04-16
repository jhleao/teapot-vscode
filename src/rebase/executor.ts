import type { RebaseIntent, RebaseIntentNode } from '../protocol';
import { GitClient } from '../git/gitClient';

export class GitRebaseExecutor {
  static async execute(repoRoot: string, intent: RebaseIntent): Promise<void> {
    const git = await GitClient.open(repoRoot);
    if (!git) {
      throw new Error('Not a git repository');
    }

    const originalBranch = await git.getCurrentBranch();
    await executeIntentNode(git, intent.root, intent.targetBaseSha);

    if (originalBranch) {
      await git.checkout(originalBranch);
    }
  }
}

async function executeIntentNode(
  git: GitClient,
  node: RebaseIntentNode,
  targetBaseSha: string
): Promise<Map<string, string>> {
  const oldOwnedOldestFirst = [...node.ownedShas].reverse();

  await git.rebaseBranchOnto({
    branchRef: node.branchRef,
    upstreamSha: node.baseSha,
    targetBaseSha,
  });

  const rebasedHeadSha = await git.revParse(node.branchRef);
  // Rebase preserves commit order on the first-parent chain, which lets us map
  // each original owned commit to its rewritten counterpart by position.
  const rebasedOwnedNewestFirst = await git.getCommitShas({
    fromRef: targetBaseSha,
    toRef: rebasedHeadSha,
    limit: Math.max(oldOwnedOldestFirst.length, 1) + 32,
  });
  const rebasedOwnedOldestFirst = [...rebasedOwnedNewestFirst].reverse();
  const rewrittenShasByOriginal = createRewriteMap(oldOwnedOldestFirst, rebasedOwnedOldestFirst);

  for (const child of node.children) {
    const childTargetBaseSha =
      rewrittenShasByOriginal.get(child.baseSha) ??
      (child.baseSha === node.headSha ? rebasedHeadSha : null);
    if (!childTargetBaseSha) {
      throw new Error(
        `Unable to map rebased base for ${child.branchRef}. ` +
          `Expected rewrite for ${child.baseSha.slice(0, 7)}.`
      );
    }

    await executeIntentNode(git, child, childTargetBaseSha);
  }

  return rewrittenShasByOriginal;
}

function createRewriteMap(
  originalOwnedOldestFirst: string[],
  rebasedOwnedOldestFirst: string[]
): Map<string, string> {
  if (originalOwnedOldestFirst.length !== rebasedOwnedOldestFirst.length) {
    throw new Error(
      `Rebase changed commit count from ${originalOwnedOldestFirst.length} ` +
        `to ${rebasedOwnedOldestFirst.length}.`
    );
  }

  const rewrittenShasByOriginal = new Map<string, string>();
  for (const [index, originalSha] of originalOwnedOldestFirst.entries()) {
    const rebasedSha = rebasedOwnedOldestFirst[index];
    if (!rebasedSha) {
      throw new Error(`Missing rebased SHA for ${originalSha.slice(0, 7)}.`);
    }
    rewrittenShasByOriginal.set(originalSha, rebasedSha);
  }

  return rewrittenShasByOriginal;
}
