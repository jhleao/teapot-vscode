import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitClient } from '../../git/gitClient';
import { GitStackBuilder } from '../../git/stackBuilder';
import { RebaseQueueExecutor } from '../executor';
import { createRebaseIntent } from '../intent';
import { QueueBuilderUtils } from '../queueBuilder';
import { OperationQueueStore } from '../queueStore';

describe('RebaseQueueExecutor', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    'rebases a branch subtree and preserves a direct child branch',
    async () => {
      const repoDir = mkdtempSync(join(tmpdir(), 'teapot-vscode-rebase-executor-'));
      tempDirs.push(repoDir);

      git(repoDir, ['init', '--quiet', '-b', 'main']);
      git(repoDir, ['config', 'user.name', 'Teapot Tests']);
      git(repoDir, ['config', 'user.email', 'teapot@example.com']);

      commitFile(repoDir, 'main-1.txt', 'main 1');
      const mainBaseSha = revParse(repoDir, 'HEAD');
      commitFile(repoDir, 'main-2.txt', 'main 2');
      commitFile(repoDir, 'main-3.txt', 'main 3');
      const mainHeadSha = revParse(repoDir, 'HEAD');

      git(repoDir, ['checkout', '--quiet', '-b', 'feature', mainBaseSha]);
      commitFile(repoDir, 'feature-1.txt', 'feature 1');
      commitFile(repoDir, 'feature-2.txt', 'feature 2');
      const originalFeatureHeadSha = revParse(repoDir, 'HEAD');

      git(repoDir, ['checkout', '--quiet', '-b', 'fixup', originalFeatureHeadSha]);
      commitFile(repoDir, 'fixup-1.txt', 'fixup 1');
      const originalFixupHeadSha = revParse(repoDir, 'HEAD');

      git(repoDir, ['checkout', '--quiet', 'main']);

      const before = await GitStackBuilder.build(repoDir);
      const intent = createRebaseIntent(before, 'feature', mainHeadSha);
      if (!intent) {
        throw new Error('Expected rebase intent');
      }

      const gitForOriginalBranch = await GitClient.open(repoDir);
      const originalBranch = await gitForOriginalBranch!.getCurrentBranch();
      const store = new OperationQueueStore(repoDir);
      const queue = QueueBuilderUtils.fromIntent(intent, {
        repoRoot: repoDir,
        originalBranchRef: originalBranch,
        label: 'test',
      });
      await store.save(queue);
      const executor = new RebaseQueueExecutor(repoDir, store);
      const outcome = await executor.runUntilBlocked(queue);
      expect(outcome.kind).toBe('drained');

      const after = await GitStackBuilder.build(repoDir);
      const branchesByRef = new Map(after.branches.map((branch) => [branch.ref, branch]));
      const feature = branchesByRef.get('feature');
      const fixup = branchesByRef.get('fixup');

      expect(after.current).toBe('main');
      expect(feature?.baseSha).toBe(mainHeadSha);
      expect(feature?.headSha).not.toBe(originalFeatureHeadSha);
      expect(fixup?.headSha).not.toBe(originalFixupHeadSha);
      expect(fixup?.parentRef).toBe('feature');
      expect(fixup?.baseSha).toBe(feature?.headSha);
    },
    15_000
  );
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
