import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '../githubClient';

describe('GitHubClient.listPulls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends conditional requests when an etag is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: {
          etag: '"etag-123"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('token');
    const result = await client.listPulls('owner', 'repo', { etag: '"etag-123"' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls?state=all&sort=updated&direction=desc&per_page=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'If-None-Match': '"etag-123"',
        }),
      })
    );
    expect(result).toEqual({
      status: 'not-modified',
      etag: '"etag-123"',
    });
  });

  it('returns the payload and new etag for modified responses', async () => {
    const pulls = [
      {
        number: 42,
        html_url: 'https://github.com/owner/repo/pull/42',
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
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(pulls), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: '"etag-456"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('token');
    const result = await client.listPulls('owner', 'repo');

    expect(result).toEqual({
      status: 'modified',
      pulls,
      etag: '"etag-456"',
    });
  });
});

describe('GitHubClient.createPullRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the expected payload and returns the created pull request', async () => {
    const pull = {
      number: 7,
      html_url: 'https://github.com/owner/repo/pull/7',
      state: 'open' as const,
      draft: false,
      merged_at: null,
      head: {
        ref: 'feature',
        sha: 'abc123',
      },
      base: {
        ref: 'main',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(pull), {
        status: 201,
        headers: {
          'content-type': 'application/json',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('token');
    const result = await client.createPullRequest('owner', 'repo', {
      title: 'Feature title',
      head: 'feature',
      base: 'main',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          title: 'Feature title',
          head: 'feature',
          base: 'main',
        }),
      })
    );
    expect(result).toEqual(pull);
  });

  it('surfaces validation error details from 422 responses', async () => {
    const errorBody = {
      message: 'Validation Failed',
      errors: [
        {
          resource: 'PullRequest',
          code: 'custom',
          message: 'A pull request already exists for owner:feature.',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('token');
    await expect(
      client.createPullRequest('owner', 'repo', {
        title: 't',
        head: 'feature',
        base: 'main',
      })
    ).rejects.toThrow(
      'GitHub API 422: Validation Failed — A pull request already exists for owner:feature.'
    );
  });

  it('falls back to field:code when no error message is provided', async () => {
    const errorBody = {
      message: 'Validation Failed',
      errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('token');
    await expect(
      client.createPullRequest('owner', 'repo', {
        title: 't',
        head: 'feature',
        base: 'main',
      })
    ).rejects.toThrow('GitHub API 422: Validation Failed — head: invalid');
  });
});

describe('GitHubClient.updatePullRequestBase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCHes the pulls endpoint with the new base ref', async () => {
    const pull = {
      number: 9,
      html_url: 'https://github.com/owner/repo/pull/9',
      state: 'open' as const,
      draft: false,
      merged_at: null,
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'develop' },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(pull), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('token');
    const result = await client.updatePullRequestBase('owner', 'repo', 9, 'develop');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls/9',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ base: 'develop' }),
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      })
    );
    expect(result).toEqual(pull);
  });
});
