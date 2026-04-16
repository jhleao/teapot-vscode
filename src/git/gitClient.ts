import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Commit } from '../protocol';

const exec = promisify(execFile);
const GIT_EXEC_BUFFER_BYTES = 32 * 1024 * 1024;

export interface LocalBranchHead {
  name: string;
  headSha: string;
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

  private run(args: string[]): Promise<string> {
    return runGit(this.repoRoot, args);
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: GIT_EXEC_BUFFER_BYTES });
  return stdout;
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
