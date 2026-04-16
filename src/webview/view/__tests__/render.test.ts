import { describe, expect, it } from 'vitest';
import {
  buildBranchBadgeContext,
  buildCommitRowContext,
  buildWorktreeBadgeContext,
  createRebaseActionViewModel,
  normalizeCssColor,
  pickReadableForeground,
} from '../render';

describe('createRebaseActionViewModel', () => {
  it('renders enabled confirm and cancel actions by default', () => {
    const viewModel = createRebaseActionViewModel({
      branchName: 'feature',
      targetLabel: 'main',
      pendingAction: null,
    });

    expect(viewModel).toEqual({
      buttons: [
        {
          action: 'cancel-rebase',
          disabled: false,
          label: 'Cancel',
        },
        {
          action: 'confirm-rebase',
          disabled: false,
          label: 'Confirm',
          primary: true,
        },
      ],
    });
  });

  it('disables both buttons while confirm is pending', () => {
    const viewModel = createRebaseActionViewModel({
      branchName: 'feature',
      targetLabel: 'main',
      pendingAction: 'confirm',
    });

    expect(viewModel.buttons).toEqual([
      {
        action: 'cancel-rebase',
        disabled: true,
        label: 'Cancel',
      },
      {
        action: 'confirm-rebase',
        disabled: true,
        label: 'Confirming...',
        primary: true,
      },
    ]);
  });

  it('disables both buttons while cancel is pending', () => {
    const viewModel = createRebaseActionViewModel({
      branchName: 'feature',
      targetLabel: 'main',
      pendingAction: 'cancel',
    });

    expect(viewModel.buttons).toEqual([
      {
        action: 'cancel-rebase',
        disabled: true,
        label: 'Canceling...',
      },
      {
        action: 'confirm-rebase',
        disabled: true,
        label: 'Confirm',
        primary: true,
      },
    ]);
  });

  it('disables both buttons while the preview is syncing to the host', () => {
    const viewModel = createRebaseActionViewModel({
      branchName: 'feature',
      targetLabel: 'main',
      pendingAction: 'sync',
    });

    expect(viewModel.buttons).toEqual([
      {
        action: 'cancel-rebase',
        disabled: true,
        label: 'Cancel',
      },
      {
        action: 'confirm-rebase',
        disabled: true,
        label: 'Confirm',
        primary: true,
      },
    ]);
  });
});

describe('buildBranchBadgeContext', () => {
  it('marks a normal branch as unprotected and carries the ref', () => {
    expect(
      buildBranchBadgeContext({
        branchRef: 'feature/xyz',
        isProtected: false,
        isCurrent: false,
        hasWorktree: false,
      })
    ).toEqual({
      webviewSection: 'branch-badge',
      preventDefaultContextMenuItems: true,
      branchRef: 'feature/xyz',
      teapotBranchProtected: false,
      teapotBranchIsCurrent: false,
      teapotBranchHasWorktree: false,
    });
  });

  it('marks current/trunk branches as protected so Delete is hidden', () => {
    expect(
      buildBranchBadgeContext({
        branchRef: 'main',
        isProtected: true,
        isCurrent: false,
        hasWorktree: false,
      })
    ).toMatchObject({
      teapotBranchProtected: true,
      teapotBranchIsCurrent: false,
    });
  });

  it('flags the current branch so Checkout can be hidden', () => {
    expect(
      buildBranchBadgeContext({
        branchRef: 'feature/xyz',
        isProtected: true,
        isCurrent: true,
        hasWorktree: false,
      })
    ).toMatchObject({
      teapotBranchIsCurrent: true,
    });
  });

  it('flags branches that already have a worktree so New Worktree is hidden', () => {
    expect(
      buildBranchBadgeContext({
        branchRef: 'feature/xyz',
        isProtected: false,
        isCurrent: false,
        hasWorktree: true,
      })
    ).toMatchObject({
      teapotBranchHasWorktree: true,
    });
  });
});

describe('buildCommitRowContext', () => {
  it('exposes sha, current message, and HEAD flag for amend gating', () => {
    expect(
      buildCommitRowContext({
        commitSha: 'abc1234',
        currentMessage: 'Initial commit',
        isHead: true,
      })
    ).toEqual({
      webviewSection: 'commit-row',
      preventDefaultContextMenuItems: true,
      commitSha: 'abc1234',
      currentMessage: 'Initial commit',
      teapotCommitIsHead: true,
    });
  });

  it('flips the HEAD flag off when the commit is not HEAD', () => {
    expect(
      buildCommitRowContext({ commitSha: 'def5678', currentMessage: 'Old', isHead: false })
    ).toMatchObject({ teapotCommitIsHead: false });
  });
});

describe('buildWorktreeBadgeContext', () => {
  it('carries the branch ref and worktree path for the worktree menu', () => {
    expect(
      buildWorktreeBadgeContext({
        branchRef: 'feature/xyz',
        worktreePath: '/tmp/wt/feature-xyz',
      })
    ).toEqual({
      webviewSection: 'worktree-badge',
      preventDefaultContextMenuItems: true,
      branchRef: 'feature/xyz',
      worktreePath: '/tmp/wt/feature-xyz',
    });
  });
});

describe('pickReadableForeground', () => {
  it('returns black for light Peacock colors', () => {
    expect(pickReadableForeground('#fff5b0')).toBe('#000000');
    expect(pickReadableForeground('#ffd700')).toBe('#000000');
  });

  it('returns white for dark Peacock colors', () => {
    expect(pickReadableForeground('#1e1e1e')).toBe('#ffffff');
    expect(pickReadableForeground('#0e639c')).toBe('#ffffff');
  });

  it('handles short hex forms', () => {
    expect(pickReadableForeground('#fff')).toBe('#000000');
    expect(pickReadableForeground('#000')).toBe('#ffffff');
  });

  it('returns null for unparseable input so the default style is kept', () => {
    expect(pickReadableForeground('not-a-color')).toBeNull();
    expect(pickReadableForeground('rgb(10, 20, 30)')).toBeNull();
  });
});

describe('normalizeCssColor', () => {
  it('prepends # to bare hex because CSS requires it (Peacock stores bare hex)', () => {
    expect(normalizeCssColor('d0d0d0')).toBe('#d0d0d0');
    expect(normalizeCssColor('FFF')).toBe('#FFF');
  });

  it('leaves already-prefixed hex untouched', () => {
    expect(normalizeCssColor('#88bb22')).toBe('#88bb22');
  });

  it('passes through other CSS color forms unchanged', () => {
    expect(normalizeCssColor('rgb(12, 34, 56)')).toBe('rgb(12, 34, 56)');
    expect(normalizeCssColor('red')).toBe('red');
  });

  it('returns null for empty input', () => {
    expect(normalizeCssColor('')).toBeNull();
    expect(normalizeCssColor('   ')).toBeNull();
  });
});
