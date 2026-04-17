import { randomUUID } from 'node:crypto';
import type {
  OperationQueue,
  QueuedStep,
  RebaseIntent,
  RebaseIntentNode,
  TargetBase,
} from '../protocol';

export interface BuildQueueOptions {
  repoRoot: string;
  originalBranchRef: string | null;
  label: string;
}

export class QueueBuilderUtils {
  static fromIntent(intent: RebaseIntent, options: BuildQueueOptions): OperationQueue {
    const rootTarget: TargetBase = { kind: 'sha', sha: intent.targetBaseSha };
    const steps: QueuedStep[] = [];
    appendTreeSteps(intent.root, rootTarget, steps);
    steps.push(createRestoreHeadStep(options.originalBranchRef));

    return {
      schemaVersion: 1,
      createdAtMs: Date.now(),
      repoRoot: options.repoRoot,
      originalBranchRef: options.originalBranchRef,
      steps,
      cursor: 0,
      completedHeads: {},
      label: options.label,
    };
  }

  static fromSubtrees(
    subtrees: RebaseIntentNode[],
    sharedTargetBase: TargetBase,
    options: BuildQueueOptions
  ): OperationQueue {
    const steps: QueuedStep[] = [];
    for (const subtree of subtrees) {
      appendTreeSteps(subtree, sharedTargetBase, steps);
    }
    steps.push(createRestoreHeadStep(options.originalBranchRef));

    return {
      schemaVersion: 1,
      createdAtMs: Date.now(),
      repoRoot: options.repoRoot,
      originalBranchRef: options.originalBranchRef,
      steps,
      cursor: 0,
      completedHeads: {},
      label: options.label,
    };
  }
}

function appendTreeSteps(
  node: RebaseIntentNode,
  targetBase: TargetBase,
  out: QueuedStep[]
): void {
  const step: QueuedStep = {
    kind: 'rebase-branch',
    id: randomUUID(),
    branchRef: node.branchRef,
    upstreamSha: node.headSha,
    preRebaseHeadSha: node.headSha,
    targetBase,
  };
  out.push(step);

  for (const child of node.children) {
    appendTreeSteps(child, { kind: 'completed-step-head', stepId: step.id }, out);
  }
}

function createRestoreHeadStep(branchRef: string | null): QueuedStep {
  return {
    kind: 'restore-head',
    id: randomUUID(),
    branchRef,
  };
}
