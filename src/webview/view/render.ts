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
    rowElement.dataset.vscodeContext = JSON.stringify(
      buildCommitRowContext({
        commitSha: row.commit.sha,
        currentMessage: row.commit.message,
        isHead: row.isCurrent,
      })
    );
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
    rowElement.append(
      createRowLabels(
        row.branchName,
        row.isCurrent,
        row.isTrunkBranch,
        row.worktreePath,
        row.worktreePeacockColor
      )
    );
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

function createRowLabels(
  branchName: string,
  isCurrent: boolean,
  isTrunkBranch: boolean,
  worktreePath: string | null,
  worktreePeacockColor: string | null
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'label-container';
  container.append(createBranchLabel(branchName, isCurrent, isTrunkBranch));
  if (worktreePath) {
    container.append(createWorktreeLabel(branchName, worktreePath, worktreePeacockColor));
  }
  return container;
}

function createBranchLabel(
  branchName: string,
  isCurrent: boolean,
  isTrunkBranch: boolean
): HTMLElement {
  const label = document.createElement('span');
  label.className = 'label branch';
  if (isCurrent) {
    label.classList.add('current');
  }
  label.title = branchName;
  label.dataset.vscodeContext = JSON.stringify(
    buildBranchBadgeContext({
      branchRef: branchName,
      isProtected: isCurrent || isTrunkBranch,
    })
  );

  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = branchName;

  label.append(text);
  return label;
}

function createWorktreeLabel(
  branchRef: string,
  worktreePath: string,
  peacockColor: string | null
): HTMLElement {
  const label = document.createElement('span');
  label.className = 'label worktree';
  label.title = worktreePath;
  label.dataset.vscodeContext = JSON.stringify(
    buildWorktreeBadgeContext({ branchRef, worktreePath })
  );

  if (peacockColor) {
    applyPeacockColor(label, peacockColor);
  }

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'label-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.75');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 21v-6m0 0l-3-3m3 3l3-3m-3-3V3m0 9l-6-6m6 6l6-6');
  icon.append(path);

  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = basename(worktreePath);

  label.append(icon, text);
  return label;
}

function applyPeacockColor(label: HTMLElement, peacockColor: string): void {
  const normalized = normalizeCssColor(peacockColor);
  if (!normalized) {
    return;
  }
  label.classList.add('peacock');
  label.style.setProperty('--peacock-color', normalized);
  const foreground = pickReadableForeground(normalized);
  if (foreground) {
    label.style.setProperty('--peacock-foreground', foreground);
  }
}

export function normalizeCssColor(color: string): string | null {
  const trimmed = color.trim();
  if (!trimmed) {
    return null;
  }

  // Peacock often stores bare hex like "d0d0d0" — CSS requires the leading '#'.
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) {
    return `#${trimmed}`;
  }

  return trimmed;
}

export function pickReadableForeground(color: string): string | null {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return null;
  }

  const [r, g, b] = rgb;
  // Rec. 601 luma — cheap, matches how Peacock itself decides light/dark backgrounds
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#000000' : '#ffffff';
}

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!match) {
    return null;
  }

  const hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return [r, g, b];
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }

  return null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
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

export interface BranchBadgeContext {
  webviewSection: 'branch-badge';
  preventDefaultContextMenuItems: true;
  branchRef: string;
  teapotBranchProtected: boolean;
}

export function buildBranchBadgeContext(options: {
  branchRef: string;
  isProtected: boolean;
}): BranchBadgeContext {
  return {
    webviewSection: 'branch-badge',
    preventDefaultContextMenuItems: true,
    branchRef: options.branchRef,
    teapotBranchProtected: options.isProtected,
  };
}

export interface WorktreeBadgeContext {
  webviewSection: 'worktree-badge';
  preventDefaultContextMenuItems: true;
  branchRef: string;
  worktreePath: string;
}

export function buildWorktreeBadgeContext(options: {
  branchRef: string;
  worktreePath: string;
}): WorktreeBadgeContext {
  return {
    webviewSection: 'worktree-badge',
    preventDefaultContextMenuItems: true,
    branchRef: options.branchRef,
    worktreePath: options.worktreePath,
  };
}

export interface CommitRowContext {
  webviewSection: 'commit-row';
  preventDefaultContextMenuItems: true;
  commitSha: string;
  currentMessage: string;
  teapotCommitIsHead: boolean;
}

export function buildCommitRowContext(options: {
  commitSha: string;
  currentMessage: string;
  isHead: boolean;
}): CommitRowContext {
  return {
    webviewSection: 'commit-row',
    preventDefaultContextMenuItems: true,
    commitSha: options.commitSha,
    currentMessage: options.currentMessage,
    teapotCommitIsHead: options.isHead,
  };
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
