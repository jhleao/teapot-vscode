export interface GitHubRepoHandle {
  owner: string;
  repo: string;
}

export class GitHubRemoteUtils {
  private static readonly HTTPS = /^https?:\/\/(?:[^@/]*@)?github\.com\/([^/]+)\/([^/]+?)\/?$/;
  private static readonly SSH_SHORT = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/;
  private static readonly SSH_URL = /^ssh:\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+)\/([^/]+?)\/?$/;
  private static readonly GIT_PROTO = /^git:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/;

  static parse(url: string): GitHubRepoHandle | null {
    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    const withoutGit = trimmed.replace(/\.git\/?$/, '');

    for (const pattern of [
      GitHubRemoteUtils.HTTPS,
      GitHubRemoteUtils.SSH_SHORT,
      GitHubRemoteUtils.SSH_URL,
      GitHubRemoteUtils.GIT_PROTO,
    ]) {
      const match = pattern.exec(withoutGit);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    }

    return null;
  }
}
