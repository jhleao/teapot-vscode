import { readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { OperationQueue } from '../protocol';

export class OperationQueueStore {
  private readonly queuePath: string;

  constructor(
    private readonly repoRoot: string,
    gitDir = resolveGitDirFromRepoRoot(repoRoot)
  ) {
    this.queuePath = join(gitDir, 'teapot', 'operation-queue.json');
  }

  getPath(): string {
    return this.queuePath;
  }

  async load(): Promise<OperationQueue | null> {
    let contents: string;
    try {
      contents = await readFile(this.queuePath, 'utf8');
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      await this.clear();
      return null;
    }

    if (!isOperationQueue(parsed) || parsed.repoRoot !== this.repoRoot) {
      await this.clear();
      return null;
    }

    return parsed;
  }

  async save(queue: OperationQueue): Promise<void> {
    await mkdir(dirname(this.queuePath), { recursive: true });
    const tmpPath = `${this.queuePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(queue, null, 2), 'utf8');
    await rename(tmpPath, this.queuePath);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.queuePath);
    } catch {
      // ignore
    }
  }
}

function isOperationQueue(value: unknown): value is OperationQueue {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const q = value as Partial<OperationQueue>;
  if (q.schemaVersion !== 1) return false;
  if (typeof q.createdAtMs !== 'number') return false;
  if (typeof q.repoRoot !== 'string') return false;
  if (q.originalBranchRef !== null && typeof q.originalBranchRef !== 'string') return false;
  if (!Array.isArray(q.steps)) return false;
  if (typeof q.cursor !== 'number') return false;
  if (!q.completedHeads || typeof q.completedHeads !== 'object') return false;
  if (typeof q.label !== 'string') return false;

  for (const step of q.steps) {
    if (!step || typeof step !== 'object') return false;
    if (step.kind === 'rebase-branch') {
      if (
        typeof step.id !== 'string' ||
        typeof step.branchRef !== 'string' ||
        typeof step.upstreamSha !== 'string' ||
        typeof step.preRebaseHeadSha !== 'string' ||
        !isTargetBase(step.targetBase)
      ) {
        return false;
      }
    } else if (step.kind === 'restore-head') {
      if (
        typeof step.id !== 'string' ||
        (step.branchRef !== null && typeof step.branchRef !== 'string')
      ) {
        return false;
      }
    } else {
      return false;
    }
  }

  return true;
}

function isTargetBase(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const tb = value as { kind?: string; sha?: unknown; ref?: unknown; stepId?: unknown };
  if (tb.kind === 'sha') return typeof tb.sha === 'string';
  if (tb.kind === 'ref') return typeof tb.ref === 'string';
  if (tb.kind === 'completed-step-head') return typeof tb.stepId === 'string';
  return false;
}

export function resolveGitDirFromRepoRoot(repoRoot: string): string {
  const dotGitPath = join(repoRoot, '.git');

  try {
    const dotGitStat = statSync(dotGitPath);
    if (dotGitStat.isDirectory()) {
      return dotGitPath;
    }
    if (dotGitStat.isFile()) {
      const contents = readFileSync(dotGitPath, 'utf8');
      const match = contents.match(/^gitdir:\s*(.+?)\s*$/i);
      if (match?.[1]) {
        const gitDir = match[1];
        return isAbsolute(gitDir) ? gitDir : resolve(repoRoot, gitDir);
      }
    }
  } catch {
    // Fall back to the historical location; callers will surface any I/O error.
  }

  return dotGitPath;
}
