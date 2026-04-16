import { describe, expect, it } from 'vitest';
import { createRebaseActionViewModel } from '../render';

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
