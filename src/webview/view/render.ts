import type { StackState } from '../../protocol';
import { layoutRows, type RowModel } from '../graph/layout';
import { renderRowGraph } from '../graph/svg';

export function renderStackView(root: HTMLElement, state: StackState): void {
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

  for (const row of rows) {
    fragment.append(renderRow(row));
  }

  root.append(fragment);
}

function renderRow(row: RowModel): HTMLElement {
  const rowElement = document.createElement('div');
  rowElement.className = 'row';

  if (row.isCurrent) {
    rowElement.classList.add('current');
  }
  if (row.kind === 'branch-header') {
    rowElement.classList.add('branch-header');
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
