import type { PullRequestInfo, PullRequestState, StackBranch } from '../protocol';
import type { GitHubPullPayload } from './githubClient';

const STATE_PRIORITY: Record<PullRequestState, number> = {
  open: 3,
  draft: 2,
  merged: 1,
  closed: 0,
};

export interface PushExpectationInput {
  expectedHeadSha: string;
  expectedBaseRef: string | null;
  syntheticPull?: GitHubPullPayload | null;
}

export interface PrMatchResult {
  prs: Map<string, PullRequestInfo>;
  satisfiedExpectations: Set<string>;
}

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
    expectedBaseRefByBranch: ReadonlyMap<string, string | null> = new Map(),
    pushExpectations: ReadonlyMap<string, PushExpectationInput> = new Map()
  ): PrMatchResult {
    const prs = new Map<string, PullRequestInfo>();
    const satisfiedExpectations = new Set<string>();
    if (branches.length === 0) {
      return { prs, satisfiedExpectations };
    }
    if (pulls.length === 0 && pushExpectations.size === 0) {
      return { prs, satisfiedExpectations };
    }

    const bestPullByName = GitHubPrResolver.bestPullByBranchName(pulls);

    for (const branch of branches) {
      const normalized = GitHubPrResolver.normalizeBranchName(branch);
      const expectation = pushExpectations.get(branch.ref);
      const realPull = bestPullByName.get(normalized);
      // GitHub's list endpoint can lag behind a just-created PR. If we hold a
      // synthetic payload from the create response, use it until the real list
      // catches up.
      const pull = realPull ?? expectation?.syntheticPull ?? null;
      if (!pull) {
        continue;
      }
      const usingSynthetic = !realPull;

      const state = GitHubPrResolver.deriveState(pull);
      const isLive = state === 'open' || state === 'draft';
      const expectedBase = expectedBaseRefByBranch.get(branch.ref) ?? null;
      const headMatches = pull.head.sha === branch.headSha;
      const baseMatches = expectedBase === null || pull.base.ref === expectedBase;

      let isInSync = isLive ? headMatches && baseMatches : true;

      if (isLive && expectation) {
        const expectationHeadOk = pull.head.sha === expectation.expectedHeadSha;
        const expectationBaseOk =
          expectation.expectedBaseRef === null ||
          pull.base.ref === expectation.expectedBaseRef;
        // An expectation is only satisfied once the REAL list reflects it.
        // While we're still rendering from a synthetic payload, the propagation
        // loop should keep refetching.
        if (!usingSynthetic && expectationHeadOk && expectationBaseOk) {
          satisfiedExpectations.add(branch.ref);
        } else {
          // GitHub hasn't propagated our just-pushed state yet. Trust local
          // truth: render as in-sync while the propagation loop keeps refetching.
          isInSync = true;
        }
      }

      prs.set(branch.ref, {
        number: pull.number,
        url: pull.html_url,
        state,
        isInSync,
        baseRef: pull.base.ref,
      });
    }

    return { prs, satisfiedExpectations };
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
