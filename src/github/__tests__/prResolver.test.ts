import { describe, expect, it } from 'vitest';
import type { StackBranch } from '../../protocol';
import type { GitHubPullPayload } from '../githubClient';
import { GitHubPrResolver, type PushExpectationInput } from '../prResolver';

function createBranch(overrides: Partial<StackBranch>): StackBranch {
  return {
    ref: 'feature',
    headSha: 'abc123',
    baseSha: 'def456',
    parentRef: null,
    childRefs: [],
    commits: [],
    isTrunk: false,
    isRemote: false,
    isCurrent: false,
    hasUncommittedChanges: false,
    worktreePath: null,
    worktreePeacockColor: null,
    pullRequest: null,
    ...overrides,
  };
}

function createPull(overrides: Partial<GitHubPullPayload> = {}): GitHubPullPayload {
  return {
    number: 1,
    html_url: 'https://github.com/a/b/pull/1',
    state: 'open',
    draft: false,
    merged_at: null,
    head: { ref: 'feature', sha: 'abc123' },
    base: { ref: 'main' },
    ...overrides,
  };
}

describe('GitHubPrResolver.deriveState', () => {
  it('returns merged when merged_at is present (even if state says closed)', () => {
    const pull = createPull({ state: 'closed', merged_at: '2025-01-01T00:00:00Z' });
    expect(GitHubPrResolver.deriveState(pull)).toBe('merged');
  });

  it('returns closed for closed non-merged PRs', () => {
    expect(GitHubPrResolver.deriveState(createPull({ state: 'closed' }))).toBe('closed');
  });

  it('returns draft for open drafts', () => {
    expect(GitHubPrResolver.deriveState(createPull({ draft: true }))).toBe('draft');
  });

  it('returns open for everything else', () => {
    expect(GitHubPrResolver.deriveState(createPull())).toBe('open');
  });
});

describe('GitHubPrResolver.normalizeBranchName', () => {
  it('strips the remote prefix from remote-tracking branches', () => {
    expect(
      GitHubPrResolver.normalizeBranchName(
        createBranch({ ref: 'origin/feature', isRemote: true })
      )
    ).toBe('feature');
  });

  it('leaves local branch names unchanged even if they contain slashes', () => {
    expect(
      GitHubPrResolver.normalizeBranchName(
        createBranch({ ref: 'feature/add-pr-badges', isRemote: false })
      )
    ).toBe('feature/add-pr-badges');
  });
});

describe('GitHubPrResolver.match', () => {
  it('returns empty when there are no PRs', () => {
    const { prs, satisfiedExpectations } = GitHubPrResolver.match([createBranch({})], []);
    expect(prs.size).toBe(0);
    expect(satisfiedExpectations.size).toBe(0);
  });

  it('marks an open PR in sync when head SHAs match', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'abc123' });
    const pull = createPull({ number: 42, head: { ref: 'feature', sha: 'abc123' } });

    const { prs } = GitHubPrResolver.match([branch], [pull]);

    expect(prs.get('feature')).toEqual({
      number: 42,
      url: pull.html_url,
      state: 'open',
      isInSync: true,
      baseRef: 'main',
    });
  });

  it('marks an open PR out of sync when head SHA differs', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'localsha' });
    const pull = createPull({ head: { ref: 'feature', sha: 'remotesha' } });

    const { prs } = GitHubPrResolver.match([branch], [pull]);

    expect(prs.get('feature')?.isInSync).toBe(false);
  });

  it('forces isInSync=true for merged PRs regardless of SHA', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'localsha' });
    const pull = createPull({
      merged_at: '2025-01-01T00:00:00Z',
      state: 'closed',
      head: { ref: 'feature', sha: 'remotesha' },
    });

    const { prs } = GitHubPrResolver.match([branch], [pull]);

    expect(prs.get('feature')).toMatchObject({ state: 'merged', isInSync: true });
  });

  it('picks the best-priority PR when multiple share a branch name', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'abc' });
    const mergedOld = createPull({
      number: 1,
      merged_at: '2025-01-01T00:00:00Z',
      state: 'closed',
      head: { ref: 'feature', sha: 'oldsha' },
    });
    const openNew = createPull({
      number: 2,
      head: { ref: 'feature', sha: 'abc' },
    });

    const { prs } = GitHubPrResolver.match([branch], [mergedOld, openNew]);

    expect(prs.get('feature')).toMatchObject({ number: 2, state: 'open' });
  });

  it('normalizes remote-tracking refs before matching', () => {
    const branch = createBranch({
      ref: 'origin/feature',
      headSha: 'abc',
      isRemote: true,
    });
    const pull = createPull({ head: { ref: 'feature', sha: 'abc' } });

    const { prs } = GitHubPrResolver.match([branch], [pull]);

    expect(prs.get('origin/feature')).toMatchObject({ isInSync: true });
  });

  it('returns no entry when no branch matches a PR', () => {
    const branch = createBranch({ ref: 'unrelated' });
    const pull = createPull({ head: { ref: 'feature', sha: 'abc' } });

    const { prs } = GitHubPrResolver.match([branch], [pull]);

    expect(prs.size).toBe(0);
  });

  it('marks PR out of sync when head matches but base ref differs from expected', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'abc' });
    const pull = createPull({
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'main' },
    });
    const expected = new Map<string, string | null>([['feature', 'develop']]);

    const { prs } = GitHubPrResolver.match([branch], [pull], expected);

    expect(prs.get('feature')).toMatchObject({ isInSync: false, baseRef: 'main' });
  });

  it('marks PR in sync when both head sha and base ref match expected', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'abc' });
    const pull = createPull({
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'develop' },
    });
    const expected = new Map<string, string | null>([['feature', 'develop']]);

    const { prs } = GitHubPrResolver.match([branch], [pull], expected);

    expect(prs.get('feature')).toMatchObject({ isInSync: true, baseRef: 'develop' });
  });

  it('ignores base divergence for merged/closed PRs', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'abc' });
    const pull = createPull({
      state: 'closed',
      merged_at: '2025-01-01T00:00:00Z',
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'main' },
    });
    const expected = new Map<string, string | null>([['feature', 'develop']]);

    const { prs } = GitHubPrResolver.match([branch], [pull], expected);

    expect(prs.get('feature')).toMatchObject({ state: 'merged', isInSync: true });
  });

  describe('push expectations', () => {
    it('overrides isInSync to true when stale GitHub data contradicts an active expectation', () => {
      const branch = createBranch({ ref: 'feature', headSha: 'new-sha' });
      const stalePull = createPull({ head: { ref: 'feature', sha: 'old-sha' } });
      const expectations = new Map<string, PushExpectationInput>([
        ['feature', { expectedHeadSha: 'new-sha', expectedBaseRef: null }],
      ]);

      const { prs, satisfiedExpectations } = GitHubPrResolver.match(
        [branch],
        [stalePull],
        new Map(),
        expectations
      );

      expect(prs.get('feature')?.isInSync).toBe(true);
      expect(satisfiedExpectations.has('feature')).toBe(false);
    });

    it('reports expectation satisfied when the fetched pull matches', () => {
      const branch = createBranch({ ref: 'feature', headSha: 'new-sha' });
      const freshPull = createPull({ head: { ref: 'feature', sha: 'new-sha' } });
      const expectations = new Map<string, PushExpectationInput>([
        ['feature', { expectedHeadSha: 'new-sha', expectedBaseRef: null }],
      ]);

      const { prs, satisfiedExpectations } = GitHubPrResolver.match(
        [branch],
        [freshPull],
        new Map(),
        expectations
      );

      expect(prs.get('feature')?.isInSync).toBe(true);
      expect(satisfiedExpectations.has('feature')).toBe(true);
    });

    it('requires expected base ref to match when specified', () => {
      const branch = createBranch({ ref: 'feature', headSha: 'new-sha' });
      const pull = createPull({
        head: { ref: 'feature', sha: 'new-sha' },
        base: { ref: 'main' },
      });
      const expectations = new Map<string, PushExpectationInput>([
        ['feature', { expectedHeadSha: 'new-sha', expectedBaseRef: 'develop' }],
      ]);

      const { prs, satisfiedExpectations } = GitHubPrResolver.match(
        [branch],
        [pull],
        new Map(),
        expectations
      );

      // Expectation not satisfied yet (base hasn't propagated), so override kicks in.
      expect(prs.get('feature')?.isInSync).toBe(true);
      expect(satisfiedExpectations.has('feature')).toBe(false);
    });

    it('injects a synthetic pull when the real list does not yet contain the branch', () => {
      const branch = createBranch({ ref: 'feature', headSha: 'new-sha' });
      const synthetic = createPull({
        number: 99,
        head: { ref: 'feature', sha: 'new-sha' },
      });
      const expectations = new Map<string, PushExpectationInput>([
        [
          'feature',
          {
            expectedHeadSha: 'new-sha',
            expectedBaseRef: null,
            syntheticPull: synthetic,
          },
        ],
      ]);

      const { prs, satisfiedExpectations } = GitHubPrResolver.match(
        [branch],
        [],
        new Map(),
        expectations
      );

      expect(prs.get('feature')).toMatchObject({ number: 99, isInSync: true });
      // Using a synthetic means the real list hasn't caught up — expectation
      // must stay active so the propagation loop keeps refetching.
      expect(satisfiedExpectations.has('feature')).toBe(false);
    });

    it('prefers the real pull over the synthetic once the list catches up', () => {
      const branch = createBranch({ ref: 'feature', headSha: 'new-sha' });
      const synthetic = createPull({
        number: 99,
        head: { ref: 'feature', sha: 'new-sha' },
      });
      const real = createPull({ number: 99, head: { ref: 'feature', sha: 'new-sha' } });
      const expectations = new Map<string, PushExpectationInput>([
        [
          'feature',
          {
            expectedHeadSha: 'new-sha',
            expectedBaseRef: null,
            syntheticPull: synthetic,
          },
        ],
      ]);

      const { satisfiedExpectations } = GitHubPrResolver.match(
        [branch],
        [real],
        new Map(),
        expectations
      );

      expect(satisfiedExpectations.has('feature')).toBe(true);
    });

    it('does not override isInSync for merged/closed PRs (expectation ignored)', () => {
      const branch = createBranch({ ref: 'feature', headSha: 'new-sha' });
      const closedPull = createPull({
        state: 'closed',
        head: { ref: 'feature', sha: 'old-sha' },
      });
      const expectations = new Map<string, PushExpectationInput>([
        ['feature', { expectedHeadSha: 'new-sha', expectedBaseRef: null }],
      ]);

      const { prs, satisfiedExpectations } = GitHubPrResolver.match(
        [branch],
        [closedPull],
        new Map(),
        expectations
      );

      expect(prs.get('feature')).toMatchObject({ state: 'closed', isInSync: true });
      expect(satisfiedExpectations.has('feature')).toBe(false);
    });
  });
});
