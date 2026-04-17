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
}

export class GitHubClient {
  private static readonly API_BASE = 'https://api.github.com';

  constructor(private readonly token: string) {}

  async listPulls(owner: string, repo: string): Promise<GitHubPullPayload[]> {
    const url =
      `${GitHubClient.API_BASE}/repos/${owner}/${repo}/pulls` +
      '?state=all&sort=updated&direction=desc&per_page=100';

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'teapot-vscode',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as GitHubPullPayload[];
  }
}
