import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StackBranch } from '../../protocol';
import type { GitHubPullListResponse, GitHubPullPayload } from '../../github/githubClient';

const mocks = vi.hoisted(() => {
  const getRemoteUrl = vi.fn();
  const openGit = vi.fn();
  const getSilentSession = vi.fn();
  const listPulls = vi.fn();

  return {
    getRemoteUrl,
    openGit,
    getSilentSession,
    listPulls,
  };
});

vi.mock('../../git/gitClient', () => ({
  GitClient: {
    open: mocks.openGit,
  },
}));

vi.mock('../../github/auth', () => ({
  GitHubAuthUtils: {
    getSilentSession: mocks.getSilentSession,
  },
}));

vi.mock('../../github/githubClient', async () => {
  const actual = await vi.importActual<typeof import('../../github/githubClient')>(
    '../../github/githubClient'
  );

  return {
    ...actual,
    GitHubClient: class MockGitHubClient {
      async listPulls(
        owner: string,
        repo: string,
        options?: { etag?: string | null }
      ): Promise<GitHubPullListResponse> {
        return mocks.listPulls(owner, repo, options);
      }
    },
  };
});

import { GitHubPrEnricher } from '../githubPrEnricher';

function createBranch(overrides: Partial<StackBranch> = {}): StackBranch {
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
    isMergedIntoTrunk: false,
    ...overrides,
  };
}

function createPull(overrides: Partial<GitHubPullPayload> = {}): GitHubPullPayload {
  return {
    number: 1,
    html_url: 'https://github.com/acme/teapot/pull/1',
    state: 'open',
    draft: false,
    merged_at: null,
    head: {
      ref: 'feature',
      sha: 'abc123',
    },
    base: {
      ref: 'main',
    },
    ...overrides,
  };
}

function createSession(accessToken = 'token'): { accessToken: string } {
  return { accessToken };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

async function nextTick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('GitHubPrEnricher', () => {
  afterEach(() => {
    mocks.getRemoteUrl.mockReset();
    mocks.openGit.mockReset();
    mocks.getSilentSession.mockReset();
    mocks.listPulls.mockReset();
  });

  it('caches repo metadata, auth, and pulls across repeated refreshes', async () => {
    mocks.openGit.mockResolvedValue({
      getRemoteUrl: mocks.getRemoteUrl,
    });
    mocks.getRemoteUrl.mockResolvedValue('https://github.com/acme/teapot.git');
    mocks.getSilentSession.mockResolvedValue(createSession());
    mocks.listPulls.mockResolvedValue({
      status: 'modified',
      pulls: [createPull()],
      etag: '"etag-1"',
    });

    const enricher = new GitHubPrEnricher();
    const first = await enricher.enrich('/repo', [createBranch()]);
    const second = await enricher.enrich('/repo', [createBranch()]);

    expect(first.prs.get('feature')?.number).toBe(1);
    expect(second.prs.get('feature')?.number).toBe(1);
    expect(mocks.getRemoteUrl).toHaveBeenCalledTimes(1);
    expect(mocks.getSilentSession).toHaveBeenCalledTimes(1);
    expect(mocks.listPulls).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached repo metadata when the repo config changes', async () => {
    mocks.openGit.mockResolvedValue({
      getRemoteUrl: mocks.getRemoteUrl,
    });
    mocks.getRemoteUrl
      .mockResolvedValueOnce('https://github.com/acme/teapot.git')
      .mockResolvedValueOnce('https://gitlab.com/acme/teapot.git');
    mocks.getSilentSession.mockResolvedValue(createSession());
    mocks.listPulls.mockResolvedValue({
      status: 'modified',
      pulls: [createPull()],
      etag: '"etag-1"',
    });

    const enricher = new GitHubPrEnricher();
    const first = await enricher.enrich('/repo', [createBranch()]);

    enricher.invalidateRepo('/repo');
    const second = await enricher.enrich('/repo', [createBranch()]);

    expect(first.prs.size).toBe(1);
    expect(second.prs.size).toBe(0);
    expect(mocks.getRemoteUrl).toHaveBeenCalledTimes(2);
    expect(mocks.listPulls).toHaveBeenCalledTimes(1);
  });

  it('caches missing auth until auth state is invalidated', async () => {
    mocks.openGit.mockResolvedValue({
      getRemoteUrl: mocks.getRemoteUrl,
    });
    mocks.getRemoteUrl.mockResolvedValue('https://github.com/acme/teapot.git');
    mocks.getSilentSession.mockResolvedValueOnce(undefined).mockResolvedValueOnce(createSession());
    mocks.listPulls.mockResolvedValue({
      status: 'modified',
      pulls: [createPull()],
      etag: '"etag-1"',
    });

    const enricher = new GitHubPrEnricher();
    expect((await enricher.enrich('/repo', [createBranch()])).prs.size).toBe(0);
    expect((await enricher.enrich('/repo', [createBranch()])).prs.size).toBe(0);
    expect(mocks.getSilentSession).toHaveBeenCalledTimes(1);
    expect(mocks.listPulls).not.toHaveBeenCalled();

    enricher.invalidateAuth();
    expect((await enricher.enrich('/repo', [createBranch()])).prs.size).toBe(1);
    expect(mocks.getSilentSession).toHaveBeenCalledTimes(2);
    expect(mocks.listPulls).toHaveBeenCalledTimes(1);
  });

  it('forwards push expectations so stale pulls still render as in sync', async () => {
    mocks.openGit.mockResolvedValue({
      getRemoteUrl: mocks.getRemoteUrl,
    });
    mocks.getRemoteUrl.mockResolvedValue('https://github.com/acme/teapot.git');
    mocks.getSilentSession.mockResolvedValue(createSession());
    mocks.listPulls.mockResolvedValue({
      status: 'modified',
      pulls: [createPull({ head: { ref: 'feature', sha: 'stale-sha' } })],
      etag: '"etag-1"',
    });

    const enricher = new GitHubPrEnricher();
    const result = await enricher.enrich(
      '/repo',
      [createBranch({ headSha: 'new-sha' })],
      new Map([['feature', { expectedHeadSha: 'new-sha', expectedBaseRef: null }]])
    );

    expect(result.prs.get('feature')?.isInSync).toBe(true);
    expect(result.satisfiedExpectations.has('feature')).toBe(false);
  });

  it('deduplicates concurrent pull fetches for the same repo', async () => {
    const pending = deferred<GitHubPullListResponse>();

    mocks.openGit.mockResolvedValue({
      getRemoteUrl: mocks.getRemoteUrl,
    });
    mocks.getRemoteUrl.mockResolvedValue('https://github.com/acme/teapot.git');
    mocks.getSilentSession.mockResolvedValue(createSession());
    mocks.listPulls.mockReturnValue(pending.promise);

    const enricher = new GitHubPrEnricher();
    const firstTask = enricher.enrich('/repo', [createBranch()]);
    const secondTask = enricher.enrich('/repo', [createBranch()]);

    await nextTick();
    expect(mocks.listPulls).toHaveBeenCalledTimes(1);

    pending.resolve({
      status: 'modified',
      pulls: [createPull()],
      etag: '"etag-1"',
    });

    const [first, second] = await Promise.all([firstTask, secondTask]);

    expect(first.prs.get('feature')?.number).toBe(1);
    expect(second.prs.get('feature')?.number).toBe(1);
    expect(mocks.getRemoteUrl).toHaveBeenCalledTimes(1);
    expect(mocks.getSilentSession).toHaveBeenCalledTimes(1);
  });
});
