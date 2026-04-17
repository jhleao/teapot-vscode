import { describe, it, expect } from 'vitest';
import { layoutRows } from '../layout';
import type { StackState } from '../../../protocol';

// Real-world scenario from the user's test repo:
//   * qowi (HEAD) → chore: qowi
//   * laks → chore: laks
//   | * ioqw → chore: ioqw
//   |/
//   | * branch2 → chore: test2
//   | | * lobster-53f8 → chore: test5
//   | |/
//   | * chore: test1 (branchless)
//   |/
//   * main → chore: reset repo
//
// All non-trunk branches except qowi have parent=main and baseSha=m1.
// branch2 and lobster-53f8 both carry the branchless test1 in commits[] —
// it used to render twice.
describe('scenario: sibling cluster with branchless ancestor', () => {
  it('renders test1 exactly once and keeps independent siblings as peers', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'm1',
          baseSha: 'm1',
          parentRef: null,
          childRefs: ['laks', 'ioqw', 'branch2', 'lobster-53f8'],
          commits: [{ sha: 'm1', message: 'reset repo', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true,
          isRemote: false,
          isCurrent: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'qowi',
          headSha: 'qowi_c',
          baseSha: 'laks_c',
          parentRef: 'laks',
          childRefs: [],
          commits: [{ sha: 'qowi_c', message: 'qowi', author: 'dev', timeMs: 500, parentSha: 'laks_c' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: true,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'laks',
          headSha: 'laks_c',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: ['qowi'],
          commits: [{ sha: 'laks_c', message: 'laks', author: 'dev', timeMs: 450, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'ioqw',
          headSha: 'ioqw_c',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [{ sha: 'ioqw_c', message: 'ioqw', author: 'dev', timeMs: 490, parentSha: 'm1' }],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'branch2',
          headSha: 'test2',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'test2', message: 'test2', author: 'dev', timeMs: 60, parentSha: 'test1' },
            { sha: 'test1', message: 'test1', author: 'dev', timeMs: 50, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
        {
          ref: 'lobster-53f8',
          headSha: 'test5',
          baseSha: 'm1',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'test5', message: 'test5', author: 'dev', timeMs: 80, parentSha: 'test1' },
            { sha: 'test1', message: 'test1', author: 'dev', timeMs: 50, parentSha: 'm1' },
          ],
          isTrunk: false,
          isRemote: false,
          isCurrent: false,
          worktreePath: null,
          worktreePeacockColor: null,
          pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'qowi',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);

    const test1Rows = rows.filter((row) => row.kind === 'commit' && row.commit?.sha === 'test1');
    expect(test1Rows).toHaveLength(1);
    expect(test1Rows[0]).toMatchObject({ lane: 1, branchName: 'branch2' });

    const lobsterTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'lobster-53f8' && row.isBranchTip
    );
    expect(lobsterTip?.lane).toBe(2);

    const laksTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'laks' && row.isBranchTip
    );
    const ioqwTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'ioqw' && row.isBranchTip
    );
    expect(laksTip?.lane).toBe(1);
    expect(ioqwTip?.lane).toBe(1);

    const qowiTip = rows.find(
      (row) => row.kind === 'commit' && row.branchName === 'qowi' && row.isBranchTip
    );
    expect(qowiTip?.lane).toBe(1);
  });

  // From the user's weve repo: three feature branches all peel off the same
  // branchless chain above main, and one of them (O) has its own descendant
  // branch (J — "jhleao-xgc50ts9"). The descendant has to inherit O's lane
  // so the J/O pair reads as one continuous spine instead of J jumping back
  // to lane 1 and detaching.
  it('keeps a descendant of a reattached spin-off on the spin-off lane', () => {
    const state: StackState = {
      branches: [
        {
          ref: 'main',
          headSha: 'main_tip',
          baseSha: 'main_tip',
          parentRef: null,
          childRefs: ['D', 'B', 'O'],
          commits: [{ sha: 'main_tip', message: 'main', author: 'dev', timeMs: 1, parentSha: '' }],
          isTrunk: true, isRemote: false, isCurrent: false,
          worktreePath: null, worktreePeacockColor: null, pullRequest: null,
        },
        {
          ref: 'D',
          headSha: 'D_tip',
          baseSha: 'main_tip',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'D_tip', message: 'feat: build dashboard', author: 'dev', timeMs: 100, parentSha: 'b3' },
            { sha: 'b3', message: 'fix: cloudtrail', author: 'dev', timeMs: 80, parentSha: 'b2' },
            { sha: 'b2', message: 'fix: entities', author: 'dev', timeMs: 70, parentSha: 'b1' },
            { sha: 'b1', message: 'feat: entity refs', author: 'dev', timeMs: 60, parentSha: 'main_tip' },
          ],
          isTrunk: false, isRemote: false, isCurrent: false,
          worktreePath: null, worktreePeacockColor: null, pullRequest: null,
        },
        {
          ref: 'B',
          headSha: 'B_tip',
          baseSha: 'main_tip',
          parentRef: 'main',
          childRefs: [],
          commits: [
            { sha: 'B_tip', message: 'feat: business metrics', author: 'dev', timeMs: 300, parentSha: 'b3' },
            { sha: 'b3', message: 'fix: cloudtrail', author: 'dev', timeMs: 80, parentSha: 'b2' },
            { sha: 'b2', message: 'fix: entities', author: 'dev', timeMs: 70, parentSha: 'b1' },
            { sha: 'b1', message: 'feat: entity refs', author: 'dev', timeMs: 60, parentSha: 'main_tip' },
          ],
          isTrunk: false, isRemote: false, isCurrent: false,
          worktreePath: null, worktreePeacockColor: null, pullRequest: null,
        },
        {
          ref: 'O',
          headSha: 'O_tip',
          baseSha: 'main_tip',
          parentRef: 'main',
          childRefs: ['J'],
          commits: [
            { sha: 'O_tip', message: 'feat: overview metrics', author: 'dev', timeMs: 200, parentSha: 'b3' },
            { sha: 'b3', message: 'fix: cloudtrail', author: 'dev', timeMs: 80, parentSha: 'b2' },
            { sha: 'b2', message: 'fix: entities', author: 'dev', timeMs: 70, parentSha: 'b1' },
            { sha: 'b1', message: 'feat: entity refs', author: 'dev', timeMs: 60, parentSha: 'main_tip' },
          ],
          isTrunk: false, isRemote: false, isCurrent: false,
          worktreePath: null, worktreePeacockColor: null, pullRequest: null,
        },
        {
          ref: 'J',
          headSha: 'J_tip',
          baseSha: 'O_tip',
          parentRef: 'O',
          childRefs: [],
          commits: [{ sha: 'J_tip', message: 'chore: the circle', author: 'dev', timeMs: 500, parentSha: 'O_tip' }],
          isTrunk: false, isRemote: false, isCurrent: true,
          worktreePath: null, worktreePeacockColor: null, pullRequest: null,
        },
      ],
      trunk: 'main',
      current: 'J',
      repoRoot: '/repo',
      error: null,
      pendingRebase: null,
    activeRebase: null,
    };

    const rows = layoutRows(state);

    // D is primary (oldest head among D/B/O). B and O reattach to D at the
    // divergence commit b3; their shared trailing commits get dropped, so
    // b1/b2/b3 render exactly once on D's spine.
    expect(rows.filter((r) => r.kind === 'commit' && r.commit?.sha === 'b1')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'commit' && r.commit?.sha === 'b2')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'commit' && r.commit?.sha === 'b3')).toHaveLength(1);

    const laneByTip = Object.fromEntries(
      rows
        .filter((r) => r.kind === 'commit' && r.isBranchTip)
        .map((r) => [r.branchName, r.lane])
    );

    expect(laneByTip['D']).toBe(1);
    expect(laneByTip['B']).toBe(2);
    expect(laneByTip['O']).toBe(2);
    // J inherits O's lane rather than defaulting to 1.
    expect(laneByTip['J']).toBe(2);

    // J has no branch-header (same lane as its parent O).
    const jHeader = rows.find((r) => r.kind === 'branch-header' && r.branchName === 'J');
    expect(jHeader).toBeUndefined();
  });
});
