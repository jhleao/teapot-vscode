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
  // Replay only the branch's head commit onto the new base. Earlier commits
  // along the branch belong to ancestor branches (or reflog) and stay put.
  await git.rebaseBranchOnto({
    branchRef: node.branchRef,
    upstreamSha: `${node.headSha}^`,
    targetBaseSha,
  });

  const rebasedHeadSha = await git.revParse(node.branchRef);
  const rewrittenShasByOriginal = new Map<string, string>([[node.headSha, rebasedHeadSha]]);

  for (const child of node.children) {
    const childTargetBaseSha = rewrittenShasByOriginal.get(child.baseSha);
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
