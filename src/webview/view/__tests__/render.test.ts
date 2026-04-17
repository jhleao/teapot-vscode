import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '../../../protocol';
import {
  buildBranchBadgeContext,
  buildCommitRowContext,
  buildPullRequestLabelViewModel,
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
        canCreatePullRequest: true,
      })
    ).toEqual({
      webviewSection: 'branch-badge',
      preventDefaultContextMenuItems: true,
      branchRef: 'feature/xyz',
      teapotBranchProtected: false,
      teapotBranchIsCurrent: false,
      teapotBranchHasWorktree: false,
      teapotBranchCanCreatePullRequest: true,
    });
  });

  it('marks current/trunk branches as protected so Delete is hidden', () => {
    expect(
      buildBranchBadgeContext({
        branchRef: 'main',
        isProtected: true,
        isCurrent: false,
        hasWorktree: false,
        canCreatePullRequest: false,
      })
    ).toMatchObject({
      teapotBranchProtected: true,
      teapotBranchIsCurrent: false,
      teapotBranchCanCreatePullRequest: false,
    });
  });

  it('flags the current branch so Checkout can be hidden', () => {
    expect(
      buildBranchBadgeContext({
        branchRef: 'feature/xyz',
        isProtected: true,
        isCurrent: true,
        hasWorktree: false,
        canCreatePullRequest: false,
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
        canCreatePullRequest: false,
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

describe('buildPullRequestLabelViewModel', () => {
  const basePr: PullRequestInfo = {
    number: 42,
    url: 'https://github.com/a/b/pull/42',
    state: 'open',
    isInSync: true,
  };

  it('renders an open in-sync PR as a plain #N link', () => {
    const vm = buildPullRequestLabelViewModel(basePr);

    expect(vm).toEqual({
      url: 'https://github.com/a/b/pull/42',
      text: '#42',
      title: 'Open pull request',
      cssClasses: ['label', 'pr', 'state-open'],
    });
  });

  it('adds the out-of-sync class when an open PR is behind local', () => {
    const vm = buildPullRequestLabelViewModel({ ...basePr, isInSync: false });

    expect(vm.cssClasses).toEqual(['label', 'pr', 'state-open', 'out-of-sync']);
    expect(vm.title).toContain('out of sync');
  });

  it('applies out-of-sync to drafts too since they are still live', () => {
    const vm = buildPullRequestLabelViewModel({
      ...basePr,
      state: 'draft',
      isInSync: false,
    });

    expect(vm.cssClasses).toContain('out-of-sync');
    expect(vm.text).toBe('#42 (Draft)');
  });

  it('never marks merged PRs as out-of-sync even if isInSync is false', () => {
    const vm = buildPullRequestLabelViewModel({
      ...basePr,
      state: 'merged',
      isInSync: false,
    });

    expect(vm.cssClasses).not.toContain('out-of-sync');
    expect(vm.text).toBe('#42');
  });

  it('renders closed PRs with the closed suffix and no sync warning', () => {
    const vm = buildPullRequestLabelViewModel({
      ...basePr,
      state: 'closed',
      isInSync: false,
    });

    expect(vm.cssClasses).toEqual(['label', 'pr', 'state-closed']);
    expect(vm.text).toBe('#42 (Closed)');
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
