import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export class PeacockColorUtils {
  static async readForWorktree(worktreePath: string): Promise<string | null> {
    const settingsPath = join(worktreePath, '.vscode', 'settings.json');

    let raw: string;
    try {
      raw = await readFile(settingsPath, 'utf8');
    } catch {
      return null;
    }

    const parsed = parseJsoncSafely(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const color = record['peacock.color'] ?? record['peacock.remoteColor'];
    return typeof color === 'string' && color.trim() ? color.trim() : null;
  }
}

function parseJsoncSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to JSONC handling below
  }

  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return null;
  }
}

function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringQuote = '';

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      result += ch;
      if (ch === '\\' && i + 1 < text.length) {
        result += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringQuote = ch;
      result += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  return result.replace(/,(\s*[}\]])/g, '$1');
}
