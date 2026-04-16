import { createRebaseIntent } from '../../rebase/intent';
import type { StackState } from '../../protocol';

export interface DropCandidate {
  sha: string;
  top: number;
  height: number;
}

export type ValidDropTargetShas = Set<string>;

export function collectDropCandidates(root: HTMLElement): DropCandidate[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.row[data-commit-sha]')).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      sha: element.dataset.commitSha ?? '',
      top: rect.top,
      height: rect.height,
    };
  });
}

export function findClosestCommitBelowPointer(
  pointerY: number,
  candidates: DropCandidate[],
  scrollDelta = 0
): string | null {
  let closestSha: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of getCandidatesBelowPointer(pointerY, candidates, scrollDelta)) {
    const distance = candidate.distance;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestSha = candidate.candidate.sha;
    }
  }

  return closestSha;
}

export function resolveDropTarget(
  pointerY: number,
  candidates: DropCandidate[],
  validDropTargetShas: ReadonlySet<string>,
  scrollDelta = 0
): string | null {
  for (const { candidate } of getCandidatesBelowPointer(pointerY, candidates, scrollDelta)) {
    if (validDropTargetShas.has(candidate.sha)) {
      return candidate.sha;
    }
  }

  return null;
}

export function collectValidDropTargetShas(
  state: StackState,
  branchRef: string,
  candidates: DropCandidate[]
): ValidDropTargetShas {
  const validDropTargetShas = new Set<string>();

  for (const candidate of candidates) {
    if (createRebaseIntent(state, branchRef, candidate.sha)) {
      validDropTargetShas.add(candidate.sha);
    }
  }

  return validDropTargetShas;
}

function getCandidatesBelowPointer(
  pointerY: number,
  candidates: DropCandidate[],
  scrollDelta: number
): Array<{ candidate: DropCandidate; distance: number }> {
  const adjustedPointerY = pointerY + scrollDelta;

  return candidates
    .map((candidate) => ({
      candidate,
      distance: candidate.top + candidate.height / 2 - adjustedPointerY,
    }))
    .filter((candidate) => candidate.distance > 0)
    .sort((left, right) => left.distance - right.distance);
}
