import type { RebaseIntent, StackState } from '../../protocol';
import { layoutRows, type RowModel } from '../graph/layout';
import { renderRowGraph } from '../graph/svg';

export type PendingActionState = 'sync' | 'confirm' | 'cancel' | null;

export interface RenderStackViewOptions {
  pendingAction: PendingActionState;
}

export interface RebaseActionButtonModel {
  label: string;
  action: string;
  disabled: boolean;
  primary?: boolean;
}

export interface RebaseActionViewModel {
  buttons: RebaseActionButtonModel[];
}

export function renderStackView(
  root: HTMLElement,
  state: StackState,
  options: RenderStackViewOptions
): void {
  root.replaceChildren();

  if (state.error) {
    root.append(createEmptyState(state.error, true));
    return;
  }

  if (state.branches.length === 0) {
    root.append(createEmptyState('No local branches found.'));
    return;
  }

  const rows = layoutRows(state);
  const fragment = document.createDocumentFragment();
  const pendingRebase = state.pendingRebase;

  for (const row of rows) {
    fragment.append(renderRow(row, pendingRebase, options));
  }

  root.append(fragment);
}

function renderRow(
  row: RowModel,
  pendingRebase: RebaseIntent | null,
  options: RenderStackViewOptions
): HTMLElement {
  const rowElement = document.createElement('div');
  rowElement.className = 'row';
  rowElement.dataset.branchRef = row.branchName;

  if (row.isCurrent) {
    rowElement.classList.add('current');
  }
  if (row.kind === 'branch-header') {
    rowElement.classList.add('branch-header');
  }
  if (row.rebaseStatus) {
    rowElement.classList.add(`rebase-${row.rebaseStatus}`);
  }
  if (row.kind === 'commit' && row.commit) {
    rowElement.dataset.commitSha = row.commit.sha;
  }
  if (row.isDraggable) {
    rowElement.dataset.dragBranchRef = row.branchName;
    rowElement.classList.add('drag-source');
  }
  if (row.showsRebaseActions) {
    rowElement.dataset.pendingRebaseRoot = 'true';
  }

  const graphContainer = document.createElement('div');
  graphContainer.className = 'graph-container';
  if (row.isCurrent) {
    graphContainer.classList.add('current');
  }
  graphContainer.append(renderRowGraph(row));
  rowElement.append(graphContainer);

  if (row.kind === 'commit' && row.isBranchTip) {
    rowElement.append(createBranchLabel(row.branchName, row.isCurrent));
  }

  const subject = document.createElement('span');
  subject.className = 'subject';

  if (row.kind === 'commit' && row.commit) {
    subject.textContent = row.commit.message;
    subject.title = `${row.commit.sha.slice(0, 7)}  ${row.commit.message}\n${row.commit.author}`;
  }

  rowElement.append(subject);
  if (row.showsRebaseActions) {
    rowElement.append(
      createRebaseActions({
        branchName: pendingRebase?.root.branchRef ?? row.branchName,
        targetLabel: getPendingTargetLabel(pendingRebase),
        pendingAction: options.pendingAction,
      })
    );
  }
  return rowElement;
}

function createBranchLabel(branchName: string, isCurrent: boolean): HTMLElement {
  const container = document.createElement('div');
  container.className = 'label-container';

  const label = document.createElement('span');
  label.className = 'label branch';
  if (isCurrent) {
    label.classList.add('current');
  }
  label.title = branchName;

  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = branchName;

  label.append(text);
  container.append(label);

  return container;
}

function createEmptyState(message: string, isError = false): HTMLElement {
  const element = document.createElement('div');
  element.className = `empty${isError ? ' error' : ''}`;
  element.textContent = message;
  return element;
}

function createRebaseActions(options: {
  branchName: string;
  targetLabel: string;
  pendingAction: PendingActionState;
}): HTMLElement {
  const container = document.createElement('div');
  container.className = 'rebase-actions';

  const actionViewModel = createRebaseActionViewModel(options);

  for (const button of actionViewModel.buttons) {
    container.append(createActionButton(button));
  }

  return container;
}

function createActionButton(options: RebaseActionButtonModel): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `action-button${options.primary ? ' primary' : ''}`;
  button.type = 'button';
  button.dataset.action = options.action;
  button.disabled = options.disabled;
  button.textContent = options.label;
  return button;
}

function getPendingTargetLabel(pendingRebase: RebaseIntent | null): string {
  if (!pendingRebase) {
    return '';
  }

  return pendingRebase.targetBranchRef ?? pendingRebase.targetBaseSha.slice(0, 7);
}

export function createRebaseActionViewModel(options: {
  branchName: string;
  targetLabel: string;
  pendingAction: PendingActionState;
}): RebaseActionViewModel {
  const isActionPending = options.pendingAction !== null;
  const buttons: RebaseActionButtonModel[] = [
    {
      label: options.pendingAction === 'cancel' ? 'Canceling...' : 'Cancel',
      action: 'cancel-rebase',
      disabled: isActionPending,
    },
    {
      label: options.pendingAction === 'confirm' ? 'Confirming...' : 'Confirm',
      action: 'confirm-rebase',
      primary: true,
      disabled: isActionPending,
    },
  ];

  return {
    buttons,
  };
}
