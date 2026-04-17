import { WORKTREE_ANIMALS } from './worktreeNaming';

export class BranchNamingUtils {
  static generate(taken: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = `${randomAnimal()}-${randomHex(4)}`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    return `${randomAnimal()}-${Date.now().toString(16)}`;
  }
}

function randomAnimal(): string {
  return WORKTREE_ANIMALS[Math.floor(Math.random() * WORKTREE_ANIMALS.length)];
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
