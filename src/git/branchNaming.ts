import { WORKTREE_CITIES } from './worktreeNaming';

export class BranchNamingUtils {
  static generate(taken: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = `${randomCity()}-${randomHex(4)}`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${randomCity()}-${Date.now().toString(16)}`;
  }

  static wipCommitMessage(branchName: string): string {
    return `chore: wip ${branchName}`;
  }
}

function randomCity(): string {
  return WORKTREE_CITIES[Math.floor(Math.random() * WORKTREE_CITIES.length)];
}

function randomHex(length: number): string {
  let out = '';
  while (out.length < length) {
    out += Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  }
  return out.slice(0, length);
}
