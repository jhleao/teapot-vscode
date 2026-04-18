import type { PullRequestInfo, StackBranch } from '../protocol';
import { GitClient } from '../git/gitClient';
import { GitHubAuthUtils } from '../github/auth';
import {
  GitHubClient,
  type GitHubPullPayload,
  type GitHubPullListResponse,
} from '../github/githubClient';
import { PrBaseUtils } from '../github/prBaseResolver';
import { GitHubPrResolver } from '../github/prResolver';
import { GitHubRemoteUtils, type GitHubRepoHandle } from '../github/remote';

interface PullsCacheEntry {
  fetchedAt: number;
  etag: string | null;
  pulls: GitHubPullPayload[];
}

interface RepoCacheEntry {
  repo: GitHubRepoHandle | null;
  pullsCacheKey: string | null;
}

export class GitHubPrEnricher {
  private static readonly CACHE_TTL_MS = 30_000;

  private readonly pullsCache = new Map<string, PullsCacheEntry>();
  private readonly repoCache = new Map<string, RepoCacheEntry>();
  private readonly repoLookup = new Map<string, Promise<GitHubRepoHandle | null>>();
  private readonly inFlightPulls = new Map<string, Promise<GitHubPullPayload[]>>();

  private accessTokenCache: string | null | undefined;
  private accessTokenLookup: Promise<string | null> | null = null;
  private authVersion = 0;

  async enrich(
    repoRoot: string,
    branches: StackBranch[]
  ): Promise<Map<string, PullRequestInfo>> {
    if (branches.length === 0) {
      return new Map();
    }

    const git = await GitClient.open(repoRoot);
    if (!git) {
      return new Map();
    }

    const repo = await this.getRepo(repoRoot, git);
    if (!repo) {
      return new Map();
    }

    const token = await this.getAccessToken();
    if (!token) {
      return new Map();
    }

    const pulls = await this.fetchPulls(token, repo.owner, repo.repo);
    const expectedBaseRefByBranch = PrBaseUtils.buildExpectedBaseMap(branches);
    return GitHubPrResolver.match(branches, pulls, expectedBaseRefByBranch);
  }

  invalidateAuth(): void {
    this.authVersion += 1;
    this.accessTokenCache = undefined;
    this.accessTokenLookup = null;
    this.pullsCache.clear();
    this.inFlightPulls.clear();
  }

  invalidateRepo(repoRoot: string): void {
    const cached = this.repoCache.get(repoRoot);
    if (cached?.pullsCacheKey) {
      this.clearPullsCacheEntry(cached.pullsCacheKey);
    }
    this.repoLookup.delete(repoRoot);
    this.repoCache.delete(repoRoot);
  }

  invalidatePulls(repoRoot: string): void {
    const cached = this.repoCache.get(repoRoot);
    if (!cached?.pullsCacheKey) {
      return;
    }

    this.clearPullsCacheEntry(cached.pullsCacheKey);
  }

  invalidateAll(): void {
    this.invalidateAuth();
    this.repoLookup.clear();
    this.repoCache.clear();
  }

  private async getRepo(
    repoRoot: string,
    git: GitClient
  ): Promise<GitHubRepoHandle | null> {
    const cached = this.repoCache.get(repoRoot);
    if (cached) {
      return cached.repo;
    }

    const inFlight = this.repoLookup.get(repoRoot);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const remoteUrl = await git.getRemoteUrl('origin');
      const repo = remoteUrl ? GitHubRemoteUtils.parse(remoteUrl) : null;
      const pullsCacheKey = repo ? this.getPullsCacheKey(repo.owner, repo.repo) : null;

      this.repoCache.set(repoRoot, {
        repo,
        pullsCacheKey,
      });

      return repo;
    })();

    this.repoLookup.set(repoRoot, task);

    try {
      return await task;
    } finally {
      this.repoLookup.delete(repoRoot);
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessTokenCache !== undefined) {
      return this.accessTokenCache;
    }

    if (this.accessTokenLookup) {
      return this.accessTokenLookup;
    }

    this.accessTokenLookup = (async () => {
      try {
        const session = await GitHubAuthUtils.getSilentSession();
        const token = session?.accessToken ?? null;
        this.accessTokenCache = token;
        return token;
      } finally {
        this.accessTokenLookup = null;
      }
    })();

    return this.accessTokenLookup;
  }

  private async fetchPulls(
    token: string,
    owner: string,
    repo: string
  ): Promise<GitHubPullPayload[]> {
    const key = this.getPullsCacheKey(owner, repo);
    const now = Date.now();
    const cached = this.pullsCache.get(key);

    if (cached && now - cached.fetchedAt < GitHubPrEnricher.CACHE_TTL_MS) {
      return cached.pulls;
    }

    const inFlight = this.inFlightPulls.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = this.fetchPullsWithRevalidation(token, owner, repo, cached, key);
    this.inFlightPulls.set(key, task);

    try {
      return await task;
    } finally {
      this.inFlightPulls.delete(key);
    }
  }

  private async fetchPullsWithRevalidation(
    token: string,
    owner: string,
    repo: string,
    cached: PullsCacheEntry | undefined,
    cacheKey: string
  ): Promise<GitHubPullPayload[]> {
    const authVersion = this.authVersion;
    const client = new GitHubClient(token);
    const response = await client.listPulls(owner, repo, {
      etag: cached?.etag,
    });

    return this.storePullsResponse(cacheKey, response, cached, authVersion);
  }

  private storePullsResponse(
    cacheKey: string,
    response: GitHubPullListResponse,
    cached: PullsCacheEntry | undefined,
    authVersion: number
  ): GitHubPullPayload[] {
    if (authVersion !== this.authVersion) {
      return response.status === 'modified' ? response.pulls : cached?.pulls ?? [];
    }

    const fetchedAt = Date.now();

    if (response.status === 'not-modified') {
      const pulls = cached?.pulls ?? [];
      this.pullsCache.set(cacheKey, {
        fetchedAt,
        etag: response.etag ?? cached?.etag ?? null,
        pulls,
      });
      return pulls;
    }

    this.pullsCache.set(cacheKey, {
      fetchedAt,
      etag: response.etag,
      pulls: response.pulls,
    });
    return response.pulls;
  }

  private getPullsCacheKey(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  private clearPullsCacheEntry(cacheKey: string): void {
    this.pullsCache.delete(cacheKey);
    this.inFlightPulls.delete(cacheKey);
  }
}
