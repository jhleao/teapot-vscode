import { describe, expect, it } from 'vitest';
import { GitHubRemoteUtils } from '../remote';

describe('GitHubRemoteUtils.parse', () => {
  it('parses https clone URLs with .git suffix', () => {
    expect(GitHubRemoteUtils.parse('https://github.com/jhleao/teapot.git')).toEqual({
      owner: 'jhleao',
      repo: 'teapot',
    });
  });

  it('parses https URLs without .git', () => {
    expect(GitHubRemoteUtils.parse('https://github.com/jhleao/teapot')).toEqual({
      owner: 'jhleao',
      repo: 'teapot',
    });
  });

  it('parses https URLs with embedded credentials', () => {
    expect(
      GitHubRemoteUtils.parse('https://user:token@github.com/jhleao/teapot.git')
    ).toEqual({ owner: 'jhleao', repo: 'teapot' });
  });

  it('parses ssh short form', () => {
    expect(GitHubRemoteUtils.parse('git@github.com:jhleao/teapot.git')).toEqual({
      owner: 'jhleao',
      repo: 'teapot',
    });
  });

  it('parses ssh url form with optional port', () => {
    expect(GitHubRemoteUtils.parse('ssh://git@github.com/jhleao/teapot.git')).toEqual({
      owner: 'jhleao',
      repo: 'teapot',
    });
    expect(GitHubRemoteUtils.parse('ssh://git@github.com:22/jhleao/teapot.git')).toEqual({
      owner: 'jhleao',
      repo: 'teapot',
    });
  });

  it('parses git protocol urls', () => {
    expect(GitHubRemoteUtils.parse('git://github.com/jhleao/teapot.git')).toEqual({
      owner: 'jhleao',
      repo: 'teapot',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(GitHubRemoteUtils.parse('  https://github.com/a/b.git  ')).toEqual({
      owner: 'a',
      repo: 'b',
    });
  });

  it('returns null for non-GitHub hosts', () => {
    expect(GitHubRemoteUtils.parse('https://gitlab.com/jhleao/teapot.git')).toBeNull();
    expect(GitHubRemoteUtils.parse('git@bitbucket.org:jhleao/teapot.git')).toBeNull();
  });

  it('returns null for empty or malformed input', () => {
    expect(GitHubRemoteUtils.parse('')).toBeNull();
    expect(GitHubRemoteUtils.parse('not-a-url')).toBeNull();
    expect(GitHubRemoteUtils.parse('https://github.com/only-owner')).toBeNull();
  });
});
