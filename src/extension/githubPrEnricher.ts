import type { PullRequestInfo, StackBranch } from '../protocol';
import { GitClient } from '../git/gitClient';
import { GitHubAuthUtils } from '../github/auth';
import { GitHubClient, type GitHubPullPayload } from '../github/githubClient';
import { GitHubPrResolver } from '../github/prResolver';
import { GitHubRemoteUtils } from '../github/remote';

interface PullsCacheEntry {
  key: string;
  fetchedAt: number;
  pulls: GitHubPullPayload[];
}

export class GitHubPrEnricher {
  private static readonly CACHE_TTL_MS = 30_000;
  private cache: PullsCacheEntry | null = null;

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

    const remoteUrl = await git.getRemoteUrl('origin');
    if (!remoteUrl) {
      return new Map();
    }

    const repo = GitHubRemoteUtils.parse(remoteUrl);
    if (!repo) {
      return new Map();
    }

    const session = await GitHubAuthUtils.getSilentSession();
    if (!session) {
      return new Map();
    }

    const pulls = await this.fetchPulls(session.accessToken, repo.owner, repo.repo);
    return GitHubPrResolver.match(branches, pulls);
  }

  private async fetchPulls(
    token: string,
    owner: string,
    repo: string
  ): Promise<GitHubPullPayload[]> {
    const key = `${owner}/${repo}`;
    const now = Date.now();

    if (
      this.cache &&
      this.cache.key === key &&
      now - this.cache.fetchedAt < GitHubPrEnricher.CACHE_TTL_MS
    ) {
      return this.cache.pulls;
    }

    const client = new GitHubClient(token);
    const pulls = await client.listPulls(owner, repo);
    this.cache = { key, fetchedAt: now, pulls };
    return pulls;
  }
}
