import { describe, expect, it } from 'vitest';
import type { StackBranch } from '../../protocol';
import type { GitHubPullPayload } from '../githubClient';
import { GitHubPrResolver } from '../prResolver';

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
  it('returns an empty map when there are no PRs', () => {
    const result = GitHubPrResolver.match([createBranch({})], []);
    expect(result.size).toBe(0);
  });

  it('marks an open PR in sync when head SHAs match', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'abc123' });
    const pull = createPull({ number: 42, head: { ref: 'feature', sha: 'abc123' } });

    const result = GitHubPrResolver.match([branch], [pull]);

    expect(result.get('feature')).toEqual({
      number: 42,
      url: pull.html_url,
      state: 'open',
      isInSync: true,
    });
  });

  it('marks an open PR out of sync when head SHA differs', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'localsha' });
    const pull = createPull({ head: { ref: 'feature', sha: 'remotesha' } });

    const result = GitHubPrResolver.match([branch], [pull]);

    expect(result.get('feature')?.isInSync).toBe(false);
  });

  it('forces isInSync=true for merged PRs regardless of SHA', () => {
    const branch = createBranch({ ref: 'feature', headSha: 'localsha' });
    const pull = createPull({
      merged_at: '2025-01-01T00:00:00Z',
      state: 'closed',
      head: { ref: 'feature', sha: 'remotesha' },
    });

    const result = GitHubPrResolver.match([branch], [pull]);

    expect(result.get('feature')).toMatchObject({ state: 'merged', isInSync: true });
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

    const result = GitHubPrResolver.match([branch], [mergedOld, openNew]);

    expect(result.get('feature')).toMatchObject({ number: 2, state: 'open' });
  });

  it('normalizes remote-tracking refs before matching', () => {
    const branch = createBranch({
      ref: 'origin/feature',
      headSha: 'abc',
      isRemote: true,
    });
    const pull = createPull({ head: { ref: 'feature', sha: 'abc' } });

    const result = GitHubPrResolver.match([branch], [pull]);

    expect(result.get('origin/feature')).toMatchObject({ isInSync: true });
  });

  it('returns no entry when no branch matches a PR', () => {
    const branch = createBranch({ ref: 'unrelated' });
    const pull = createPull({ head: { ref: 'feature', sha: 'abc' } });

    const result = GitHubPrResolver.match([branch], [pull]);

    expect(result.size).toBe(0);
  });
});
