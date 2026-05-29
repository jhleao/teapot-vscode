import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// A leftover file from a crashed/killed agent never gets cleared by the
// UserPromptSubmit/SessionEnd hooks, so ignore anything older than this.
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

interface AgentAttentionFile {
  worktreePath: string;
  updatedAt: number;
}

// Returns the set of worktree paths whose agent currently wants the user's
// attention, read from <commonGitDir>/teapot/agents/*.json. Best-effort: any
// unreadable/malformed/stale file is silently skipped.
export async function readAttentionWorktreePaths(commonGitDir: string): Promise<Set<string>> {
  const dir = join(commonGitDir, 'teapot', 'agents');

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return new Set();
  }

  const now = Date.now();
  const paths = new Set<string>();

  await Promise.all(
    entries
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const parsed = await readAttentionFile(join(dir, name));
        if (!parsed) {
          return;
        }
        if (now - parsed.updatedAt > STALE_AFTER_MS) {
          return;
        }
        paths.add(normalizeWorktreePath(parsed.worktreePath));
      })
  );

  return paths;
}

export function normalizeWorktreePath(path: string): string {
  return path.replace(/\/+$/, '');
}

async function readAttentionFile(filePath: string): Promise<AgentAttentionFile | null> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const worktreePath = record.worktreePath;
  const updatedAt = record.updatedAt;

  if (typeof worktreePath !== 'string' || !worktreePath.trim()) {
    return null;
  }
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    return null;
  }

  // Hooks write `date +%s` (epoch seconds); tolerate millisecond values too.
  const updatedAtMs = updatedAt < 1e12 ? updatedAt * 1000 : updatedAt;

  return { worktreePath, updatedAt: updatedAtMs };
}
