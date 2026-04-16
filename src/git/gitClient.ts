import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Commit } from '../protocol';

const exec = promisify(execFile);
const GIT_EXEC_BUFFER_BYTES = 32 * 1024 * 1024;

export interface LocalBranchHead {
  name: string;
  headSha: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
}

export class GitClient {
  private constructor(private readonly repoRoot: string) {}

  static async open(cwd: string): Promise<GitClient | null> {
    try {
      const stdout = await runGit(cwd, ['rev-parse', '--show-toplevel']);
      const repoRoot = stdout.trim();
      return repoRoot ? new GitClient(repoRoot) : null;
    } catch {
      return null;
    }
  }

  getRepoRoot(): string {
    return this.repoRoot;
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      const stdout = await this.run(['symbolic-ref', '--short', 'HEAD']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async listLocalBranches(): Promise<LocalBranchHead[]> {
    const stdout = await this.run([
      'for-each-ref',
      '--format=%(refname:short)%09%(objectname)',
      'refs/heads/',
    ]);

    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, headSha] = line.split('\t');
        return { name, headSha };
      });
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const stdout = await this.run(['worktree', 'list', '--porcelain']);
      return parseWorktreePorcelain(stdout);
    } catch {
      return [];
    }
  }

  async mergeBase(left: string, right: string): Promise<string | null> {
    try {
      const stdout = await this.run(['merge-base', left, right]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async countCommits(fromRef: string, toRef: string): Promise<number> {
    try {
      const stdout = await this.run(['rev-list', '--count', `${fromRef}..${toRef}`]);
      return Number.parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  async getCommits(options: { fromRef: string | null; toRef: string; limit?: number }): Promise<Commit[]> {
    const { fromRef, toRef, limit = 200 } = options;
    const range = fromRef ? `${fromRef}..${toRef}` : toRef;

    try {
      const stdout = await this.run([
        'log',
        range,
        '--no-merges',
        '-n',
        String(limit),
        '--format=%H%x1f%s%x1f%an%x1f%at%x1f%P',
      ]);

      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => parseCommitLine(line));
    } catch {
      return [];
    }
  }

  async getCommitShas(options: {
    fromRef: string | null;
    toRef: string;
    limit?: number;
  }): Promise<string[]> {
    const { fromRef, toRef, limit = 200 } = options;
    const range = fromRef ? `${fromRef}..${toRef}` : toRef;

    const stdout = await this.run([
      'rev-list',
      '--first-parent',
      '-n',
      String(limit),
      range,
    ]);

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async revParse(ref: string): Promise<string> {
    const stdout = await this.run(['rev-parse', ref]);
    return stdout.trim();
  }

  async checkout(ref: string): Promise<void> {
    await this.run(['checkout', '--quiet', ref]);
  }

  async deleteBranch(name: string): Promise<void> {
    await this.run(['branch', '-D', name]);
  }

  async createBranchAt(name: string, sha: string): Promise<void> {
    await this.run(['branch', name, sha]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.run(['branch', '-m', oldName, newName]);
  }

  async amendCommitMessage(message: string): Promise<void> {
    await this.run(['commit', '--amend', '-m', message, '--allow-empty']);
  }

  async removeWorktree(path: string, options: { force?: boolean } = {}): Promise<void> {
    const args = ['worktree', 'remove'];
    if (options.force) {
      args.push('--force');
    }
    args.push(path);
    await this.run(args);
  }

  async rebaseBranchOnto(options: {
    branchRef: string;
    upstreamSha: string;
    targetBaseSha: string;
  }): Promise<void> {
    const { branchRef, upstreamSha, targetBaseSha } = options;
    await this.run([
      'rebase',
      '--quiet',
      '--reapply-cherry-picks',
      '--onto',
      targetBaseSha,
      upstreamSha,
      branchRef,
    ]);
  }

  private run(args: string[]): Promise<string> {
    return runGit(this.repoRoot, args);
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: GIT_EXEC_BUFFER_BYTES });
  return stdout;
}

export function parseWorktreePorcelain(stdout: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];

  for (const block of stdout.split(/\n\n+/)) {
    let path = '';
    let branch: string | null = null;

    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      }
    }

    if (path) {
      worktrees.push({ path, branch });
    }
  }

  return worktrees;
}

function parseCommitLine(line: string): Commit {
  const [sha = '', message = '', author = '', authoredAt = '', parents = ''] = line.split('\x1f');
  const [parentSha = ''] = parents.split(' ');

  return {
    sha,
    message,
    author,
    timeMs: Number.parseInt(authoredAt, 10) * 1000,
    parentSha,
  };
}
