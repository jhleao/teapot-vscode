import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

  static async writeForWorktree(worktreePath: string, color: string): Promise<void> {
    const vscodeDir = join(worktreePath, '.vscode');
    await mkdir(vscodeDir, { recursive: true });

    const foreground = pickReadableForeground(color) ?? '#ffffff';
    const settings = {
      'peacock.color': color,
      'workbench.colorCustomizations': {
        'activityBar.background': color,
        'activityBar.foreground': foreground,
        'activityBar.inactiveForeground': foreground,
        'titleBar.activeBackground': color,
        'titleBar.activeForeground': foreground,
        'titleBar.inactiveBackground': color,
        'titleBar.inactiveForeground': foreground,
        'statusBar.background': color,
        'statusBar.foreground': foreground,
      },
    };

    await writeFile(
      join(vscodeDir, 'settings.json'),
      `${JSON.stringify(settings, null, 2)}\n`,
      'utf8'
    );
  }
}

function pickReadableForeground(color: string): string | null {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return null;
  }
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#000000' : '#ffffff';
}

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!match) {
    return null;
  }

  const hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return [r, g, b];
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }

  return null;
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
