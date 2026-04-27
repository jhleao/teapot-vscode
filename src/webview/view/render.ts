import type {
  ActiveRebaseState,
  GitHubActivity,
  PullRequestInfo,
  RebaseIntent,
  StackBranch,
  StackState,
} from '../../protocol';
import { layoutRows, type RowModel } from '../graph/layout';
import { renderBlankRowGraph, renderRowGraph } from '../graph/svg';

export type PendingActionState =
  | 'sync'
  | 'confirm'
  | 'cancel'
  | 'continue'
  | 'abort'
  | null;

export interface RenderStackViewOptions {
  pendingAction: PendingActionState;
  pushPending?: ReadonlySet<string>;
  pullTrunkPending?: boolean;
}

const EMPTY_ACTIVITY: GitHubActivity = { isFetching: false, pendingOps: [] };

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
  if (state.error) {
    root.replaceChildren(createEmptyState(state.error, true));
    return;
  }

  if (state.branches.length === 0) {
    root.replaceChildren(createEmptyState('No local branches found.'));
    return;
  }

  const rows = layoutRows(state);
  const canCreatePullRequestByBranch = buildPullRequestCreationMap(state);
  const canRebaseWithTrunkByBranch = buildRebaseWithTrunkMap(state);
  const canSquashWithParentByBranch = buildSquashWithParentMap(state);
  const branchesByRef = new Map(state.branches.map((branch) => [branch.ref, branch]));
  const fragment = document.createDocumentFragment();
  const pendingRebase = state.pendingRebase;
  const activity = state.githubActivity ?? EMPTY_ACTIVITY;
  const pushPending = new Set<string>(options.pushPending ?? []);
  const createPrPending = new Set<string>();
  let pullTrunkPending = options.pullTrunkPending ?? false;
  for (const op of activity.pendingOps) {
    if (op.kind === 'push') {
      pushPending.add(op.branchRef);
    } else if (op.kind === 'create-pr') {
      createPrPending.add(op.branchRef);
    } else if (op.kind === 'pull-trunk') {
      pullTrunkPending = true;
    }
  }
  const rowContext: RowRenderContext = {
    pendingRebase,
    canCreatePullRequestByBranch,
    canRebaseWithTrunkByBranch,
    canSquashWithParentByBranch,
    pushPending,
    createPrPending,
    branchesByRef,
    options,
  };

  if (state.activeRebase) {
    fragment.append(createActiveRebaseSection(state.activeRebase, options.pendingAction));
  }

  if (state.trunk) {
    fragment.append(createPullTrunkRow(state.trunk, pullTrunkPending));
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (isStackTipRow(row) && rows[i - 1]?.kind !== 'branch-header') {
      fragment.append(createBlankSeparatorRow(row));
    }
    if (shouldInjectUncommittedChangesRow(row, branchesByRef)) {
      fragment.append(createUncommittedChangesRow(row));
      fragment.append(renderRow({ ...row, hasTop: true }, rowContext));
    } else {
      fragment.append(renderRow(row, rowContext));
    }
  }

  root.replaceChildren(fragment);
}

interface RowRenderContext {
  pendingRebase: RebaseIntent | null;
  canCreatePullRequestByBranch: ReadonlyMap<string, boolean>;
  canRebaseWithTrunkByBranch: ReadonlyMap<string, boolean>;
  canSquashWithParentByBranch: ReadonlyMap<string, boolean>;
  pushPending: ReadonlySet<string>;
  createPrPending: ReadonlySet<string>;
  branchesByRef: ReadonlyMap<string, StackBranch>;
  options: RenderStackViewOptions;
}

function shouldInjectUncommittedChangesRow(
  row: RowModel,
  branchesByRef: ReadonlyMap<string, StackBranch>
): boolean {
  if (row.kind !== 'commit' || !row.isBranchTip || !row.isCurrent) {
    return false;
  }
  return !!branchesByRef.get(row.branchName)?.hasUncommittedChanges;
}

// A "stack tip" is a leaf branch's tip — nothing renders directly above it
// at the same commit, so without a gap the previous stack's last row sits
// flush against this one. hasTop=false means no child/spin-off rows above
// the tip; the row above must therefore belong to an unrelated branch.
function isStackTipRow(row: RowModel): boolean {
  return (
    row.kind === 'commit' &&
    row.isBranchTip &&
    !row.isTrunkBranch &&
    !row.hasTop
  );
}

function isBranchMerged(branch: StackBranch): boolean {
  return branch.isMergedIntoTrunk || branch.pullRequest?.state === 'merged';
}

function shouldShowCleanUpOnBranchTip(
  row: RowModel,
  branchesByRef: ReadonlyMap<string, StackBranch>
): boolean {
  if (row.kind !== 'commit' || !row.isBranchTip || row.isTrunkBranch) {
    return false;
  }
  const branch = branchesByRef.get(row.branchName);
  return !!branch && isBranchMerged(branch);
}

function createBlankSeparatorRow(tipRow: RowModel): HTMLElement {
  const rowElement = document.createElement('div');
  rowElement.className = 'row blank-separator';
  rowElement.setAttribute('aria-hidden', 'true');

  const graphContainer = document.createElement('div');
  graphContainer.className = 'graph-container';
  graphContainer.append(renderBlankRowGraph(tipRow));
  rowElement.append(graphContainer);

  return rowElement;
}

function createUncommittedChangesRow(tipRow: RowModel): HTMLElement {
  const rowElement = document.createElement('div');
  rowElement.className = 'row current uncommitted-changes';

  const graphContainer = document.createElement('div');
  graphContainer.className = 'graph-container current';
  const graphRow: RowModel = {
    ...tipRow,
    kind: 'commit',
    commit: undefined,
    isBranchTip: false,
    hasBottom: true,
    rebaseStatus: null,
    showsRebaseActions: false,
    isDraggable: false,
    worktreePath: null,
    worktreePeacockColor: null,
    pullRequest: null,
    additionalBranchRefs: [],
    canCreateBranchAtCommit: false,
  };
  graphContainer.append(renderRowGraph(graphRow));
  rowElement.append(graphContainer);

  rowElement.append(createUncommittedChangesArrow());

  const subject = document.createElement('span');
  subject.className = 'subject';
  subject.textContent = 'Uncommitted changes';
  rowElement.append(subject);

  const actions = document.createElement('div');
  actions.className = 'uncommitted-changes-actions';
  actions.append(
    createUncommittedActionButton({
      action: 'branch-and-commit',
      label: 'Branch and Commit',
      icon: createBranchIcon(),
    }),
    createUncommittedActionButton({
      action: 'amend-and-rebase',
      label: 'Amend and Rebase Stack',
      icon: createAmendIcon(),
    })
  );
  rowElement.append(actions);

  return rowElement;
}

function createUncommittedChangesArrow(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'uncommitted-changes-arrow');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const corner = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  corner.setAttribute('d', 'M 14 4 H 9 A 1.5 1.5 0 0 0 7.5 5.5 V 12');
  svg.append(corner);

  const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  head.setAttribute('d', 'M 5 10 L 7.5 12.5 L 10 10');
  svg.append(head);

  return svg;
}

function createUncommittedActionButton(options: {
  action: string;
  label: string;
  icon: SVGElement;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'uncommitted-action';
  button.type = 'button';
  button.dataset.action = options.action;
  button.title = options.label;
  button.setAttribute('aria-label', options.label);
  button.append(options.icon);
  return button;
}

function createCodiconSvg(pathData: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'label-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('clip-rule', 'evenodd');
  path.setAttribute('d', pathData);
  svg.append(path);

  return svg;
}

function createBranchIcon(): SVGElement {
  return createCodiconSvg(
    'M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v4.836A2.492 2.492 0 016 9h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z'
  );
}

function createAmendIcon(): SVGElement {
  return createCodiconSvg(
    'M3.221 3.739l2.261 2.269.7-.71-1.411-1.416h.09c1.374 0 2.57.814 3.124 1.986l.901-.439A4.448 4.448 0 004.861 2.8L3.56 2.93l.76-.761-.7-.709L1.5 3.42l1.721 1.72.7-.71zM14.5 1h-7l-.5.5v3h1V2h6v8h-1.5v1h2l.5-.5v-9l-.5-.5zm-3.362 5h-.076a3.446 3.446 0 01.04 1H11v1h2v2H7v-2h2.118a4.446 4.446 0 00-.051-1H6.5l-.5.5V13h-.938l-3.405-3.429-.707.709 3.25 3.27H1V14h12v-1h-7l.5-.5V11h7v-2.5L13 8h-1.862z'
  );
}

function createActiveRebaseSection(
  activeRebase: ActiveRebaseState,
  pendingAction: PendingActionState
): HTMLElement {
  const section = document.createElement('div');
  section.className = 'active-rebase';

  const status = document.createElement('div');
  status.className = 'active-rebase-status';
  status.textContent = buildActiveRebaseStatusText(activeRebase);
  section.append(status);

  const actions = document.createElement('div');
  actions.className = 'rebase-actions';

  const isInFlight = pendingAction === 'continue' || pendingAction === 'abort';
  const abortButton = createActionButton({
    label: pendingAction === 'abort' ? 'Aborting...' : 'Abort',
    action: 'abort-rebase',
    disabled: isInFlight,
  });
  const continueButton = createActionButton({
    label: pendingAction === 'continue' ? 'Continuing...' : 'Continue',
    action: 'continue-rebase',
    primary: true,
    disabled: isInFlight || !activeRebase.gitInProgress,
  });

  actions.append(abortButton, continueButton);
  section.append(actions);
  return section;
}

function buildActiveRebaseStatusText(activeRebase: ActiveRebaseState): string {
  const branchLabel =
    activeRebase.currentStep?.branchRef ?? activeRebase.headBranchRef ?? null;

  if (!activeRebase.gitInProgress) {
    return 'Resuming rebase…';
  }

  const base = branchLabel
    ? `Rebase paused — conflict in ${branchLabel}`
    : 'Rebase paused — conflict';

  if (activeRebase.pendingStepCount > 0) {
    const suffix =
      activeRebase.pendingStepCount === 1
        ? '1 more after this'
        : `${activeRebase.pendingStepCount} more after this`;
    return `${base} (${suffix})`;
  }

  return base;
}

function renderRow(
  row: RowModel,
  context: RowRenderContext
): HTMLElement {
  const {
    pendingRebase,
    canCreatePullRequestByBranch,
    canRebaseWithTrunkByBranch,
    canSquashWithParentByBranch,
    pushPending,
    createPrPending,
    options,
  } = context;
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
        row.worktreePeacockColor,
        canCreatePullRequestByBranch.get(row.branchName) ?? false,
        canRebaseWithTrunkByBranch.get(row.branchName) ?? false,
        canSquashWithParentByBranch.get(row.branchName) ?? false,
        row.additionalBranchRefs
      )
    );
  } else if (row.pointerBranchRefs.length > 0) {
    rowElement.append(createPointerBranchLabels(row.pointerBranchRefs));
  }

  if (row.kind === 'commit' && row.canCreateBranchAtCommit && row.commit) {
    rowElement.append(createBranchAtCommitButton(row.commit.sha));
  }

  const subject = document.createElement('span');
  subject.className = 'subject';

  if (row.kind === 'commit' && row.commit) {
    subject.textContent = row.commit.message;
    subject.title = `${row.commit.sha.slice(0, 7)}  ${row.commit.message}\n${row.commit.author}`;
  }

  rowElement.append(subject);
  if (row.kind === 'commit' && row.isBranchTip && createPrPending.has(row.branchName)) {
    const prGroup = document.createElement('div');
    prGroup.className = 'pr-group';
    prGroup.append(createPendingPullRequestLabel('Creating PR…'));
    rowElement.append(prGroup);
  } else if (row.pullRequest) {
    const prGroup = document.createElement('div');
    prGroup.className = 'pr-group';
    const isPushing = pushPending.has(row.branchName);
    if (isPushing || isPullRequestOutOfSync(row.pullRequest)) {
      prGroup.append(createForcePushButton(row.branchName, isPushing));
    }
    prGroup.append(createPullRequestLabel(row.pullRequest));
    rowElement.append(prGroup);
  }
  if (row.showsRebaseActions) {
    rowElement.append(
      createRebaseActions({
        branchName: pendingRebase?.root.branchRef ?? row.branchName,
        targetLabel: getPendingTargetLabel(pendingRebase),
        pendingAction: options.pendingAction,
      })
    );
  }
  if (shouldShowCleanUpOnBranchTip(row, context.branchesByRef)) {
    rowElement.append(createCleanUpBranchButton(row.branchName));
  }
  for (const pointerRef of row.pointerBranchRefs) {
    rowElement.append(createCleanUpBranchButton(pointerRef));
  }
  return rowElement;
}

function createPullRequestLabel(pullRequest: PullRequestInfo): HTMLAnchorElement {
  const viewModel = buildPullRequestLabelViewModel(pullRequest);
  const anchor = document.createElement('a');
  anchor.className = viewModel.cssClasses.join(' ');
  anchor.href = viewModel.url;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  anchor.title = viewModel.title;

  anchor.append(createPullRequestIcon());

  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = viewModel.text;
  anchor.append(text);

  return anchor;
}

function createPullRequestIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'label-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z'
  );
  svg.append(path);
  return svg;
}

function createForcePushButton(branchRef: string, isPending = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `pr-action force-push${isPending ? ' loading' : ''}`;
  button.type = 'button';
  button.dataset.action = 'force-push-branch';
  button.dataset.branchRef = branchRef;
  if (isPending) {
    button.disabled = true;
    button.title = `Pushing "${branchRef}"…`;
    button.setAttribute('aria-label', `Pushing ${branchRef}`);
    button.append(createSpinnerIcon());
  } else {
    button.title = `Force push "${branchRef}" (--force-with-lease)`;
    button.setAttribute('aria-label', `Force push ${branchRef}`);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'label-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 13V3M4 7l4-4 4 4');
    svg.append(path);
    button.append(svg);
  }
  return button;
}

function createSpinnerIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'label-icon spinner');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arc.setAttribute('d', 'M14 8a6 6 0 1 1-6-6');
  svg.append(arc);
  return svg;
}

function createPendingPullRequestLabel(text: string): HTMLElement {
  const label = document.createElement('span');
  label.className = 'label pr pending';
  label.title = text;
  label.append(createSpinnerIcon());
  const textSpan = document.createElement('span');
  textSpan.className = 'label-text';
  textSpan.textContent = text;
  label.append(textSpan);
  return label;
}

function createBranchAtCommitButton(commitSha: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'create-branch-at-commit';
  button.type = 'button';
  button.dataset.action = 'create-branch-at-commit';
  button.dataset.commitSha = commitSha;
  button.title = 'Create a branch at this commit';
  button.setAttribute('aria-label', 'Create branch at this commit');
  button.textContent = 'Create branch';
  return button;
}

function createCleanUpBranchButton(branchRef: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'clean-up-branch';
  button.type = 'button';
  button.dataset.action = 'clean-up-branch';
  button.dataset.branchRef = branchRef;
  button.title = `Delete merged branch "${branchRef}"`;
  button.setAttribute('aria-label', `Clean up ${branchRef}`);
  button.textContent = 'Clean up';
  return button;
}

function createPullTrunkRow(trunkRef: string, isPending: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pull-trunk-row';

  const button = document.createElement('button');
  button.className = `create-branch-at-commit pull-trunk-button${isPending ? ' loading' : ''}`;
  button.type = 'button';
  button.dataset.action = 'pull-trunk';
  if (isPending) {
    button.disabled = true;
    button.title = `Pulling ${trunkRef} from origin…`;
    button.setAttribute('aria-label', `Pulling ${trunkRef} from origin`);
    button.append(createPullTrunkSpinnerIcon());
  } else {
    button.title = `Pull ${trunkRef} from origin`;
    button.setAttribute('aria-label', `Pull ${trunkRef} from origin`);
    button.append(createPullIcon());
  }
  const label = document.createElement('span');
  label.textContent = isPending ? 'pulling…' : 'git pull';
  button.append(label);
  row.append(button);
  return row;
}

function createPullTrunkSpinnerIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pull-trunk-icon spinner');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arc.setAttribute('d', 'M14 8a6 6 0 1 1-6-6');
  svg.append(arc);
  return svg;
}

function createPullIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pull-trunk-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const cloud = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cloud.setAttribute(
    'd',
    'M4.5 8.5a2.5 2.5 0 0 1 .5-4.95 3.5 3.5 0 0 1 6.79.45A2.5 2.5 0 0 1 11.5 9'
  );
  svg.append(cloud);

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M8 8.5v5.5M5.5 11.5L8 14l2.5-2.5');
  svg.append(arrow);

  return svg;
}

export function isPullRequestOutOfSync(pullRequest: PullRequestInfo): boolean {
  const isLive = pullRequest.state === 'open' || pullRequest.state === 'draft';
  return isLive && !pullRequest.isInSync;
}

function createPointerBranchLabels(pointerRefs: readonly string[]): HTMLElement {
  const container = document.createElement('div');
  container.className = 'label-container';
  for (const ref of pointerRefs) {
    container.append(createBranchLabel(ref, false, false, false, false, false, false));
  }
  return container;
}

function createRowLabels(
  branchName: string,
  isCurrent: boolean,
  isTrunkBranch: boolean,
  worktreePath: string | null,
  worktreePeacockColor: string | null,
  canCreatePullRequest: boolean,
  canRebaseWithTrunk: boolean,
  canSquashWithParent: boolean,
  additionalBranchRefs: string[]
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'label-container';
  container.append(
    createBranchLabel(
      branchName,
      isCurrent,
      isTrunkBranch,
      worktreePath !== null,
      canCreatePullRequest,
      canRebaseWithTrunk,
      canSquashWithParent
    )
  );
  if (additionalBranchRefs.length > 0) {
    container.append(createBranchOverflowBadge(branchName, additionalBranchRefs));
  }
  if (worktreePath) {
    container.append(createWorktreeLabel(branchName, worktreePath, worktreePeacockColor));
  }
  return container;
}

function createBranchOverflowBadge(
  primaryRef: string,
  additionalRefs: string[]
): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'label branch-overflow';
  badge.dataset.branchOverflowRefs = JSON.stringify(additionalRefs);
  badge.dataset.branchOverflowPrimary = primaryRef;
  const noun = additionalRefs.length === 1 ? 'branch' : 'branches';
  badge.title = `${additionalRefs.length} more ${noun} at this commit:\n${additionalRefs.join('\n')}`;
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;
  badge.textContent = `+${additionalRefs.length}`;
  return badge;
}

function createBranchLabel(
  branchName: string,
  isCurrent: boolean,
  isTrunkBranch: boolean,
  hasWorktree: boolean,
  canCreatePullRequest: boolean,
  canRebaseWithTrunk: boolean,
  canSquashWithParent: boolean
): HTMLElement {
  const label = document.createElement('span');
  label.className = 'label branch';
  if (isCurrent) {
    label.classList.add('current');
  }
  label.title = branchName;
  label.dataset.branchRef = branchName;
  label.dataset.vscodeContext = JSON.stringify(
    buildBranchBadgeContext({
      branchRef: branchName,
      isProtected: isCurrent || isTrunkBranch,
      isCurrent,
      hasWorktree,
      canCreatePullRequest,
      canRebaseWithTrunk,
      canSquashWithParent,
    })
  );

  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = branchName;

  label.append(text);
  return label;
}

function buildPullRequestCreationMap(state: StackState): Map<string, boolean> {
  const branchesByRef = new Map(state.branches.map((branch) => [branch.ref, branch]));
  const result = new Map<string, boolean>();

  for (const branch of state.branches) {
    const parentRef = branch.parentRef;
    const parent = parentRef ? branchesByRef.get(parentRef) ?? null : null;
    const canCreatePullRequest =
      !branch.isTrunk &&
      !branch.pullRequest &&
      !!parent &&
      (parent.isTrunk || !!parent.pullRequest);

    result.set(branch.ref, canCreatePullRequest);
  }

  return result;
}

function buildSquashWithParentMap(state: StackState): Map<string, boolean> {
  const branchesByRef = new Map(state.branches.map((branch) => [branch.ref, branch]));
  const result = new Map<string, boolean>();

  for (const branch of state.branches) {
    if (branch.isTrunk || branch.isMergedIntoTrunk) {
      result.set(branch.ref, false);
      continue;
    }
    if (!branch.parentRef) {
      result.set(branch.ref, false);
      continue;
    }
    const parent = branchesByRef.get(branch.parentRef);
    if (!parent || parent.isTrunk) {
      result.set(branch.ref, false);
      continue;
    }
    result.set(branch.ref, true);
  }

  return result;
}

function buildRebaseWithTrunkMap(state: StackState): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const trunk = state.branches.find((branch) => branch.isTrunk) ?? null;
  const trunkCommitShas = trunk ? new Set(trunk.commits.map((commit) => commit.sha)) : null;

  for (const branch of state.branches) {
    // "Stack base" = forks directly off trunk's current history. Using baseSha
    // membership in trunk.commits is more robust than parentRef === trunk.ref:
    // parentRef is inferred from an ancestry walk and can resolve to a sibling
    // branch that happens to share an ancestor commit, even when the branch is
    // visibly branching off trunk.
    const isStackBase =
      !branch.isTrunk &&
      !branch.isMergedIntoTrunk &&
      !!trunkCommitShas &&
      trunkCommitShas.has(branch.baseSha);
    const isBehindTrunk = !!trunk && branch.baseSha !== trunk.headSha;
    result.set(branch.ref, isStackBase && isBehindTrunk);
  }

  return result;
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
  let lastSeparatorIndex = -1;

  for (let index = path.length - 1; index >= 0; index -= 1) {
    const character = path[index];
    if (character === '/' || character === '\\') {
      lastSeparatorIndex = index;
      break;
    }
  }

  return lastSeparatorIndex >= 0 ? path.slice(lastSeparatorIndex + 1) : path;
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
  teapotBranchIsCurrent: boolean;
  teapotBranchHasWorktree: boolean;
  teapotBranchCanCreatePullRequest: boolean;
  teapotBranchCanRebaseWithTrunk: boolean;
  teapotBranchCanSquashWithParent: boolean;
}

export function buildBranchBadgeContext(options: {
  branchRef: string;
  isProtected: boolean;
  isCurrent: boolean;
  hasWorktree: boolean;
  canCreatePullRequest: boolean;
  canRebaseWithTrunk: boolean;
  canSquashWithParent: boolean;
}): BranchBadgeContext {
  return {
    webviewSection: 'branch-badge',
    preventDefaultContextMenuItems: true,
    branchRef: options.branchRef,
    teapotBranchProtected: options.isProtected,
    teapotBranchIsCurrent: options.isCurrent,
    teapotBranchHasWorktree: options.hasWorktree,
    teapotBranchCanCreatePullRequest: options.canCreatePullRequest,
    teapotBranchCanRebaseWithTrunk: options.canRebaseWithTrunk,
    teapotBranchCanSquashWithParent: options.canSquashWithParent,
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

export interface PullRequestLabelViewModel {
  url: string;
  text: string;
  title: string;
  cssClasses: string[];
}

const PR_STATE_SUFFIX: Record<PullRequestInfo['state'], string> = {
  open: '',
  draft: ' (Draft)',
  merged: '',
  closed: ' (Closed)',
};

const PR_STATE_TITLE: Record<PullRequestInfo['state'], string> = {
  open: 'Open pull request',
  draft: 'Draft pull request',
  merged: 'Merged pull request',
  closed: 'Closed pull request',
};

export function buildPullRequestLabelViewModel(
  pullRequest: PullRequestInfo
): PullRequestLabelViewModel {
  const isLive = pullRequest.state === 'open' || pullRequest.state === 'draft';
  const isOutOfSync = isLive && !pullRequest.isInSync;
  const cssClasses = ['label', 'pr', `state-${pullRequest.state}`];
  if (isOutOfSync) {
    cssClasses.push('out-of-sync');
  }

  const text = `#${pullRequest.number}${PR_STATE_SUFFIX[pullRequest.state]}`;
  const title = isOutOfSync
    ? `${PR_STATE_TITLE[pullRequest.state]} — out of sync with local branch`
    : PR_STATE_TITLE[pullRequest.state];

  return {
    url: pullRequest.url,
    text,
    title,
    cssClasses,
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
