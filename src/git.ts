import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BranchNode, Commit, StackState } from './types';

const exec = promisify(execFile);

const TRUNK_CANDIDATES = ['main', 'master', 'develop', 'trunk'];

export class GitUtils {
  private constructor() {}

  private static async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  }

  static async findRepoRoot(cwd: string): Promise<string | null> {
    try {
      const out = await GitUtils.git(cwd, ['rev-parse', '--show-toplevel']);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  static async currentBranch(cwd: string): Promise<string | null> {
    try {
      const out = await GitUtils.git(cwd, ['symbolic-ref', '--short', 'HEAD']);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  static async listBranches(cwd: string): Promise<Array<{ name: string; head: string }>> {
    const out = await GitUtils.git(cwd, [
      'for-each-ref',
      '--format=%(refname:short)%09%(objectname)',
      'refs/heads/',
    ]);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head] = line.split('\t');
        return { name, head };
      });
  }

  static async mergeBase(cwd: string, a: string, b: string): Promise<string | null> {
    try {
      const out = await GitUtils.git(cwd, ['merge-base', a, b]);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  static async countCommits(cwd: string, from: string, to: string): Promise<number> {
    try {
      const out = await GitUtils.git(cwd, ['rev-list', '--count', `${from}..${to}`]);
      return parseInt(out.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  static async logRange(cwd: string, from: string | null, to: string): Promise<Commit[]> {
    const range = from ? `${from}..${to}` : to;
    const args = [
      'log',
      range,
      `--format=%H%x1f%s%x1f%an%x1f%at`,
      '--no-merges',
      '-n',
      '200',
    ];
    let out: string;
    try {
      out = await GitUtils.git(cwd, args);
    } catch {
      return [];
    }
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, subject, author, at] = line.split('\x1f');
        return {
          sha,
          subject: subject ?? '',
          author: author ?? '',
          timeMs: parseInt(at, 10) * 1000,
        };
      });
  }

  static selectTrunk(branchNames: string[]): string | null {
    for (const c of TRUNK_CANDIDATES) {
      if (branchNames.includes(c)) return c;
    }
    return null;
  }

  /**
   * For a branch B, find the closest other branch P whose tip is an ancestor of B.
   * "Closest" = smallest commit count between P.head..B.head.
   */
  static async inferParent(
    cwd: string,
    target: { name: string; head: string },
    candidates: Array<{ name: string; head: string }>,
    trunk: string | null
  ): Promise<string | null> {
    let best: { name: string; distance: number } | null = null;
    for (const c of candidates) {
      if (c.name === target.name) continue;
      const mb = await GitUtils.mergeBase(cwd, target.head, c.head);
      if (!mb) continue;
      if (mb !== c.head) continue;
      const dist = await GitUtils.countCommits(cwd, c.head, target.head);
      if (dist === 0) continue;
      if (!best || dist < best.distance) best = { name: c.name, distance: dist };
    }
    if (best) return best.name;
    return trunk && trunk !== target.name ? trunk : null;
  }

  static async buildStack(cwd: string): Promise<StackState> {
    const repoRoot = await GitUtils.findRepoRoot(cwd);
    if (!repoRoot) {
      return { branches: [], trunk: null, current: null, repoRoot: null, error: 'Not a git repository' };
    }
    try {
      const branches = await GitUtils.listBranches(repoRoot);
      const current = await GitUtils.currentBranch(repoRoot);
      const trunk = GitUtils.selectTrunk(branches.map((b) => b.name));

      const parents = new Map<string, string | null>();
      await Promise.all(
        branches.map(async (b) => {
          if (b.name === trunk) {
            parents.set(b.name, null);
            return;
          }
          const p = await GitUtils.inferParent(repoRoot, b, branches, trunk);
          parents.set(b.name, p);
        })
      );

      const children = new Map<string, string[]>();
      for (const b of branches) children.set(b.name, []);
      for (const b of branches) {
        const p = parents.get(b.name);
        if (p && children.has(p)) children.get(p)!.push(b.name);
      }

      const nodes: BranchNode[] = await Promise.all(
        branches.map(async (b) => {
          const parent = parents.get(b.name) ?? null;
          const parentHead = parent ? branches.find((x) => x.name === parent)?.head ?? null : null;
          const isTrunk = b.name === trunk;
          const commits = isTrunk
            ? (await GitUtils.logRange(repoRoot, null, b.head)).slice(0, 5)
            : await GitUtils.logRange(repoRoot, parentHead, b.head);
          return {
            name: b.name,
            headSha: b.head,
            parent,
            isTrunk,
            isCurrent: b.name === current,
            commits,
            children: (children.get(b.name) ?? []).slice(),
          };
        })
      );

      return { branches: nodes, trunk, current, repoRoot, error: null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { branches: [], trunk: null, current: null, repoRoot, error: msg };
    }
  }
}
