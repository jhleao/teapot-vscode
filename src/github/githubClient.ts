export interface GitHubPullPayload {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged_at: string | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

export interface GitHubPullListOptions {
  etag?: string | null;
}

export interface CreateGitHubPullRequestOptions {
  title: string;
  head: string;
  base: string;
  body?: string;
}

export interface GitHubPullListModifiedResponse {
  status: 'modified';
  pulls: GitHubPullPayload[];
  etag: string | null;
}

export interface GitHubPullListNotModifiedResponse {
  status: 'not-modified';
  etag: string | null;
}

export type GitHubPullListResponse =
  | GitHubPullListModifiedResponse
  | GitHubPullListNotModifiedResponse;

export class GitHubClient {
  private static readonly API_BASE = 'https://api.github.com';

  constructor(private readonly token: string) {}

  async createPullRequest(
    owner: string,
    repo: string,
    options: CreateGitHubPullRequestOptions
  ): Promise<GitHubPullPayload> {
    const response = await fetch(`${GitHubClient.API_BASE}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new Error(await this.formatError(response));
    }

    return (await response.json()) as GitHubPullPayload;
  }

  async getPullRequest(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<GitHubPullPayload> {
    const response = await fetch(
      `${GitHubClient.API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`,
      {
        headers: this.createHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response));
    }

    return (await response.json()) as GitHubPullPayload;
  }

  async updatePullRequestBase(
    owner: string,
    repo: string,
    pullNumber: number,
    base: string
  ): Promise<GitHubPullPayload> {
    const response = await fetch(
      `${GitHubClient.API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`,
      {
        method: 'PATCH',
        headers: this.createHeaders(),
        body: JSON.stringify({ base }),
      }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response));
    }

    return (await response.json()) as GitHubPullPayload;
  }

  async listPulls(
    owner: string,
    repo: string,
    options: GitHubPullListOptions = {}
  ): Promise<GitHubPullListResponse> {
    const url =
      `${GitHubClient.API_BASE}/repos/${owner}/${repo}/pulls` +
      '?state=all&sort=updated&direction=desc&per_page=100';
    const headers = this.createHeaders();

    if (options.etag) {
      headers['If-None-Match'] = options.etag;
    }

    const response = await fetch(url, {
      headers,
    });

    const etag = response.headers.get('etag');
    if (response.status === 304) {
      return {
        status: 'not-modified',
        etag,
      };
    }

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} ${response.statusText}`);
    }

    return {
      status: 'modified',
      pulls: (await response.json()) as GitHubPullPayload[],
      etag,
    };
  }

  private createHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'teapot-vscode',
    };
  }

  private async formatError(response: Response): Promise<string> {
    const fallback = `GitHub API ${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as {
        message?: string;
        errors?: Array<{ message?: string; field?: string; code?: string }>;
      };
      const details = (payload.errors ?? [])
        .map((entry) => {
          if (entry.message) return entry.message;
          if (entry.field && entry.code) return `${entry.field}: ${entry.code}`;
          return null;
        })
        .filter((s): s is string => !!s)
        .join('; ');
      const base = payload.message ?? response.statusText;
      const suffix = details ? ` — ${details}` : '';
      if (payload.message || details) {
        return `GitHub API ${response.status}: ${base}${suffix}`;
      }
    } catch {
      // Ignore malformed error payloads and fall back to the status line.
    }

    return fallback;
  }
}
