import type { PullRequestInfo, PullRequestState, StackBranch } from '../protocol';
import type { GitHubPullPayload } from './githubClient';

const STATE_PRIORITY: Record<PullRequestState, number> = {
  open: 3,
  draft: 2,
  merged: 1,
  closed: 0,
};

export class GitHubPrResolver {
  static deriveState(pull: GitHubPullPayload): PullRequestState {
    if (pull.merged_at != null) {
      return 'merged';
    }
    if (pull.state === 'closed') {
      return 'closed';
    }
    if (pull.draft) {
      return 'draft';
    }
    return 'open';
  }

  static normalizeBranchName(branch: StackBranch): string {
    if (!branch.isRemote) {
      return branch.ref;
    }
    return branch.ref.replace(/^[^/]+\//, '');
  }

  static match(
    branches: StackBranch[],
    pulls: GitHubPullPayload[],
    expectedBaseRefByBranch: ReadonlyMap<string, string | null> = new Map()
  ): Map<string, PullRequestInfo> {
    const result = new Map<string, PullRequestInfo>();
    if (branches.length === 0 || pulls.length === 0) {
      return result;
    }

    const bestPullByName = GitHubPrResolver.bestPullByBranchName(pulls);

    for (const branch of branches) {
      const normalized = GitHubPrResolver.normalizeBranchName(branch);
      const pull = bestPullByName.get(normalized);
      if (!pull) {
        continue;
      }

      const state = GitHubPrResolver.deriveState(pull);
      const isLive = state === 'open' || state === 'draft';
      const expectedBase = expectedBaseRefByBranch.get(branch.ref) ?? null;
      const headMatches = pull.head.sha === branch.headSha;
      const baseMatches = expectedBase === null || pull.base.ref === expectedBase;

      result.set(branch.ref, {
        number: pull.number,
        url: pull.html_url,
        state,
        isInSync: isLive ? headMatches && baseMatches : true,
        baseRef: pull.base.ref,
      });
    }

    return result;
  }

  private static bestPullByBranchName(
    pulls: GitHubPullPayload[]
  ): Map<string, GitHubPullPayload> {
    const best = new Map<string, GitHubPullPayload>();

    for (const pull of pulls) {
      const name = pull.head.ref;
      const existing = best.get(name);
      if (!existing) {
        best.set(name, pull);
        continue;
      }

      const existingPriority = STATE_PRIORITY[GitHubPrResolver.deriveState(existing)];
      const pullPriority = STATE_PRIORITY[GitHubPrResolver.deriveState(pull)];
      if (pullPriority > existingPriority) {
        best.set(name, pull);
      }
    }

    return best;
  }
}
