import { createRebaseTargetValidator, type RebaseIntentPlanner } from '../../rebase/intent';
import type { StackState } from '../../protocol';

export interface DropCandidate {
  sha: string;
  top: number;
  height: number;
  rowElement?: HTMLElement;
}

export type ValidDropTargetShas = Set<string>;

export function collectDropCandidates(root: HTMLElement): DropCandidate[] {
  const candidates: DropCandidate[] = [];
  const rowElements = root.querySelectorAll<HTMLElement>('.row[data-commit-sha]');

  for (let index = 0; index < rowElements.length; index += 1) {
    const element = rowElements[index];
    const rect = element.getBoundingClientRect();
    candidates.push({
      sha: element.dataset.commitSha ?? '',
      top: rect.top,
      height: rect.height,
      rowElement: element,
    });
  }

  return candidates;
}

export function findClosestCommitBelowPointer(
  pointerY: number,
  candidates: DropCandidate[],
  scrollDelta = 0
): string | null {
  return findClosestCandidateSha(pointerY, candidates, scrollDelta);
}

export function resolveDropTarget(
  pointerY: number,
  candidates: DropCandidate[],
  validDropTargetShas: ReadonlySet<string>,
  scrollDelta = 0
): string | null {
  return findClosestCandidateSha(pointerY, candidates, scrollDelta, validDropTargetShas);
}

export function collectValidDropTargetShas(
  state: StackState,
  branchRef: string,
  candidates: DropCandidate[]
): ValidDropTargetShas {
  return collectValidDropTargetShasWithValidator(
    candidates,
    createRebaseTargetValidator(state, branchRef)
  );
}

export function collectValidDropTargetShasWithPlanner(
  candidates: DropCandidate[],
  planner: RebaseIntentPlanner
): ValidDropTargetShas {
  return collectValidDropTargetShasWithValidator(candidates, planner.isValidTarget);
}

function collectValidDropTargetShasWithValidator(
  candidates: DropCandidate[],
  isValidDropTarget: (sha: string) => boolean
): ValidDropTargetShas {
  const validDropTargetShas = new Set<string>();
  for (const candidate of candidates) {
    if (isValidDropTarget(candidate.sha)) {
      validDropTargetShas.add(candidate.sha);
    }
  }

  return validDropTargetShas;
}

function findClosestCandidateSha(
  pointerY: number,
  candidates: DropCandidate[],
  scrollDelta: number,
  allowedShas?: ReadonlySet<string>
): string | null {
  const adjustedPointerY = pointerY + scrollDelta;
  let closestSha: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (allowedShas && !allowedShas.has(candidate.sha)) {
      continue;
    }

    const distance = candidate.top + candidate.height / 2 - adjustedPointerY;
    if (distance <= 0 || distance >= closestDistance) {
      continue;
    }

    closestDistance = distance;
    closestSha = candidate.sha;
  }

  return closestSha;
}
