import { describe, expect, it } from 'vitest';
import type { StackState } from '../../../protocol';
import {
  collectValidDropTargetShas,
  findClosestCommitBelowPointer,
  resolveDropTarget,
} from '../dragAndDrop';

describe('dragAndDrop helpers', () => {
  it('finds the nearest commit below the pointer', () => {
    const target = findClosestCommitBelowPointer(25, [
      { sha: 'a', top: 0, height: 20 },
      { sha: 'b', top: 20, height: 20 },
      { sha: 'c', top: 40, height: 20 },
    ]);

    expect(target).toBe('b');
  });

  it('compensates for scroll deltas when using captured drag positions', () => {
    const target = findClosestCommitBelowPointer(
      25,
      [
        { sha: 'b', top: 20, height: 20 },
        { sha: 'c', top: 40, height: 20 },
      ],
      20
    );

    expect(target).toBe('c');
  });

  it('filters out invalid subtree drop targets using the shared intent builder', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm2',
          baseSha: 'm2',
          parentRef: null,
          childRefs: ['feature'],
          ownedShas: ['m2', 'm1'],
          commits: [
            { sha: 'm2', message: 'main 2', author: 'dev', timeMs: 2, parentSha: 'm1' },
            { sha: 'm1', message: 'main 1', author: 'dev', timeMs: 1, parentSha: '' },
          ],
          isTrunk: true,
          isRemote: false,
          isCurrent: true,
        },
        {
          ref: 'feature',
          headSha: 'f1',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['fixup'],
          ownedShas: ['f1'],
          commits: [{ sha: 'f1', message: 'feature', author: 'dev', timeMs: 3, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
        {
          ref: 'fixup',
          headSha: 'x1',
          baseSha: 'f1',
          parentRef: 'feature',
          childRefs: [],
          ownedShas: ['x1'],
          commits: [{ sha: 'x1', message: 'fixup', author: 'dev', timeMs: 4, parentSha: 'f1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
        },
      ],
      trunk: 'main',
      current: 'main',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    };

    const candidates = [
      { sha: 'f1', top: 20, height: 20 },
      { sha: 'x1', top: 40, height: 20 },
      { sha: 'm2', top: 60, height: 20 },
    ];

    const validDropTargetShas = collectValidDropTargetShas(state, 'feature', candidates);

    expect([...validDropTargetShas]).toEqual(['m2']);
    expect(resolveDropTarget(25, candidates, validDropTargetShas)).toBe('m2');
    expect(resolveDropTarget(5, candidates, validDropTargetShas)).toBe('m2');
  });
});
