import type { OperationQueue, QueuedStep, TargetBase } from '../protocol';
import { GitClient } from '../git/gitClient';
import { OperationQueueStore } from './queueStore';

export type QueueRunOutcome =
  | { kind: 'drained' }
  | { kind: 'conflict'; stepId: string }
  | { kind: 'error'; stepId: string; error: unknown };

export class RebaseQueueExecutor {
  constructor(
    private readonly repoRoot: string,
    private readonly store: OperationQueueStore
  ) {}

  async runUntilBlocked(queue: OperationQueue): Promise<QueueRunOutcome> {
    const git = await GitClient.open(this.repoRoot);
    if (!git) {
      return {
        kind: 'error',
        stepId: queue.steps[queue.cursor]?.id ?? 'unknown',
        error: new Error('Not a git repository'),
      };
    }

    while (queue.cursor < queue.steps.length) {
      const step = queue.steps[queue.cursor];
      const outcome = await runStep(git, step, queue);
      if (outcome.kind === 'conflict' || outcome.kind === 'error') {
        await this.store.save(queue);
        return outcome;
      }

      queue.cursor += 1;
      await this.store.save(queue);
    }

    await this.store.clear();
    return { kind: 'drained' };
  }
}

async function runStep(
  git: GitClient,
  step: QueuedStep,
  queue: OperationQueue
): Promise<QueueRunOutcome | { kind: 'ok' }> {
  if (step.kind === 'restore-head') {
    if (step.branchRef) {
      try {
        await git.checkout(step.branchRef);
      } catch {
        // Branch may have been deleted; best effort.
      }
    }
    return { kind: 'ok' };
  }

  let targetBaseSha: string;
  try {
    targetBaseSha = await resolveTargetBase(git, step.targetBase, queue.completedHeads);
  } catch (error) {
    return { kind: 'error', stepId: step.id, error };
  }

  try {
    await git.rebaseBranchOnto({
      branchRef: step.branchRef,
      upstreamSha: `${step.upstreamSha}^`,
      targetBaseSha,
    });
  } catch (error) {
    if ((await git.hasActiveRebase()) !== null) {
      return { kind: 'conflict', stepId: step.id };
    }
    return { kind: 'error', stepId: step.id, error };
  }

  const newHead = await git.revParse(step.branchRef);
  queue.completedHeads[step.id] = newHead;
  return { kind: 'ok' };
}

async function resolveTargetBase(
  git: GitClient,
  targetBase: TargetBase,
  completedHeads: Record<string, string>
): Promise<string> {
  if (targetBase.kind === 'sha') {
    return targetBase.sha;
  }
  if (targetBase.kind === 'ref') {
    return await git.revParse(targetBase.ref);
  }
  const head = completedHeads[targetBase.stepId];
  if (!head) {
    throw new Error(`Queue integrity: missing completed head for step ${targetBase.stepId}`);
  }
  return head;
}
