import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitStackBuilder } from '../stackBuilder';

describe('GitStackBuilder', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads enough trunk history to keep older direct branch fork points available', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'teapot-vscode-stack-builder-'));
    tempDirs.push(repoDir);

    git(repoDir, ['init', '--quiet', '-b', 'main']);
    git(repoDir, ['config', 'user.name', 'Teapot Tests']);
    git(repoDir, ['config', 'user.email', 'teapot@example.com']);

    const trunkCommitShas: string[] = [];
    for (let index = 1; index <= 8; index += 1) {
      commitFile(repoDir, `trunk-${index}`, `trunk commit ${index}`);
      trunkCommitShas.push(revParse(repoDir, 'HEAD'));
    }

    const legacyBaseSha = trunkCommitShas[1];
    if (!legacyBaseSha) {
      throw new Error('Expected legacy base SHA');
    }

    git(repoDir, ['checkout', '--quiet', '-b', 'legacy-feature', legacyBaseSha]);
    commitFile(repoDir, 'legacy.txt', 'legacy feature');

    git(repoDir, ['checkout', '--quiet', 'main']);
    const mainHeadBeforeFutureBranch = revParse(repoDir, 'HEAD');

    git(repoDir, ['checkout', '--quiet', '-b', 'future-feature']);
    commitFile(repoDir, 'future.txt', 'future feature');

    git(repoDir, ['checkout', '--quiet', 'main']);

    const state = await GitStackBuilder.build(repoDir);
    const branchesByRef = new Map(state.branches.map((branch) => [branch.ref, branch]));

    expect(state.error).toBeNull();
    expect(branchesByRef.get('legacy-feature')?.baseSha).toBe(legacyBaseSha);
    expect(branchesByRef.get('future-feature')?.baseSha).toBe(mainHeadBeforeFutureBranch);
    expect(branchesByRef.get('main')?.commits.some((commit) => commit.sha === legacyBaseSha)).toBe(
      true
    );
  });
});

function commitFile(repoDir: string, filename: string, contents: string): void {
  const filePath = join(repoDir, filename);
  writeFileSync(filePath, `${contents}\n`);
  git(repoDir, ['add', filename]);
  git(repoDir, ['commit', '--quiet', '-m', contents]);
}

function revParse(repoDir: string, ref: string): string {
  return git(repoDir, ['rev-parse', ref]).trim();
}

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
}
