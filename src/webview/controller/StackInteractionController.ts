import { createRebaseIntentPlanner } from '../../rebase/intent';
import { applyRebaseIntentToState } from '../../rebase/project';
import type {
  HostToWebviewMessage,
  StackState,
  WebviewToHostMessage,
} from '../../protocol';
import {
  collectValidDropTargetShasWithPlanner,
  collectDropCandidates,
  type DropCandidate,
  type ValidDropTargetShas,
  resolveDropTarget,
} from '../view/dragAndDrop';
import { renderStackView, type PendingActionState } from '../view/render';

interface DragSession {
  pendingBranchRef: string | null;
  activeBranchRef: string | null;
  createIntent: ReturnType<typeof createRebaseIntentPlanner>['createIntent'] | null;
  startX: number;
  startY: number;
  targetSha: string | null;
  dropCandidates: DropCandidate[];
  dropRowsBySha: Map<string, HTMLElement>;
  validDropTargetShas: ValidDropTargetShas;
  initialScrollTop: number;
  lastPointerY: number;
  autoScrollFrame: number | null;
}

type RebaseAction =
  | 'confirm-rebase'
  | 'cancel-rebase'
  | 'continue-rebase'
  | 'abort-rebase';
type ForcePushAction = 'force-push-branch';
type CreateBranchAction = 'create-branch-at-commit';
type UncommittedAction = 'amend-and-rebase' | 'branch-and-commit';

const DRAG_THRESHOLD_PX = 4;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_SPEED = 14;

export class StackInteractionController {
  private previewRollbackState: StackState | null = null;
  private renderedState: StackState | null = null;
  private pendingAction: PendingActionState = null;
  private awaitingHostSync = false;

  private readonly drag: DragSession = {
    pendingBranchRef: null,
    activeBranchRef: null,
    createIntent: null,
    startX: 0,
    startY: 0,
    targetSha: null,
    dropCandidates: [],
    dropRowsBySha: new Map<string, HTMLElement>(),
    validDropTargetShas: new Set<string>(),
    initialScrollTop: 0,
    lastPointerY: 0,
    autoScrollFrame: null,
  };

  constructor(
    private readonly elements: {
      viewportElement: HTMLElement;
      contentElement: HTMLElement;
    },
    private readonly postMessage: (message: WebviewToHostMessage) => void
  ) {}

  handleHostMessage(message: HostToWebviewMessage): void {
    if (message.type !== 'stack') {
      return;
    }

    const shouldRender =
      !this.renderedState ||
      this.pendingAction !== null ||
      this.drag.activeBranchRef !== null ||
      !areStackStatesVisuallyEqual(this.renderedState, message.state);

    this.renderedState = message.state;
    if (!message.state.pendingRebase) {
      this.previewRollbackState = null;
    }
    this.pendingAction = null;
    this.awaitingHostSync = false;
    this.resetDragSession();
    if (shouldRender) {
      this.render();
      this.revealPendingRebaseActions();
    }
  }

  handleMouseDown(event: MouseEvent): void {
    if (
      event.button !== 0 ||
      !this.renderedState ||
      this.renderedState.pendingRebase ||
      this.renderedState.activeRebase ||
      this.awaitingHostSync
    ) {
      return;
    }

    const targetElement = event.target as HTMLElement;
    if (targetElement.closest('.label.branch-overflow')) {
      return;
    }

    const sourceRow = targetElement.closest<HTMLElement>('.row[data-drag-branch-ref]');
    const branchRef = sourceRow?.dataset.dragBranchRef;
    if (!branchRef) {
      return;
    }

    this.drag.pendingBranchRef = branchRef;
    this.drag.startX = event.clientX;
    this.drag.startY = event.clientY;
    this.drag.lastPointerY = event.clientY;
    event.preventDefault();
  }

  handleClick(event: MouseEvent): void {
    const overflowBadge = (event.target as HTMLElement).closest<HTMLElement>(
      '.label.branch-overflow'
    );
    if (overflowBadge) {
      if (this.awaitingHostSync || this.drag.activeBranchRef) {
        return;
      }
      const branchRefs = parseBranchOverflowRefs(overflowBadge.dataset.branchOverflowRefs);
      if (branchRefs.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        this.postMessage({ type: 'pickBranchAction', branchRefs });
      }
      return;
    }

    const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-action]'
    );
    const action = actionButton?.dataset.action;

    if (isForcePushAction(action)) {
      const branchRef = actionButton?.dataset.branchRef;
      if (branchRef) {
        this.postMessage({ type: 'forcePushBranch', branchRef });
      }
      return;
    }

    if (isCreateBranchAction(action)) {
      const commitSha = actionButton?.dataset.commitSha;
      if (commitSha) {
        event.preventDefault();
        event.stopPropagation();
        this.postMessage({ type: 'createBranchAtCommit', commitSha });
      }
      return;
    }

    if (isUncommittedAction(action)) {
      event.preventDefault();
      event.stopPropagation();
      this.postMessage(
        action === 'amend-and-rebase'
          ? { type: 'amendAndRebase' }
          : { type: 'branchAndCommit' }
      );
      return;
    }

    if (this.awaitingHostSync) {
      return;
    }

    if (!isRebaseAction(action)) {
      return;
    }

    this.handleActionClick(action);
  }

  handleDoubleClick(event: MouseEvent): void {
    if (
      this.awaitingHostSync ||
      this.renderedState?.pendingRebase ||
      this.drag.activeBranchRef
    ) {
      return;
    }

    const label = (event.target as HTMLElement).closest<HTMLElement>('.label.branch');
    if (!label || label.classList.contains('current')) {
      return;
    }

    const branchRef = label.dataset.branchRef;
    if (!branchRef) {
      return;
    }

    this.postMessage({ type: 'checkoutBranch', branchRef });
  }

  handleMouseMove(event: MouseEvent): void {
    const currentState = this.renderedState;
    this.drag.lastPointerY = event.clientY;

    if (currentState && this.drag.pendingBranchRef && !this.drag.activeBranchRef) {
      const deltaX = event.clientX - this.drag.startX;
      const deltaY = event.clientY - this.drag.startY;
      if (Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX) {
        this.startDragSession(currentState, this.drag.pendingBranchRef);
      }
    }

    if (!this.drag.activeBranchRef) {
      return;
    }

    this.updateDropTarget(event.clientY);
    this.ensureAutoScroll();
  }

  handleScroll(): void {
    if (!this.drag.activeBranchRef) {
      return;
    }

    this.updateDropTarget(this.drag.lastPointerY);
  }

  handleMouseUp(): void {
    const currentState = this.renderedState;
    const activeBranchRef = this.drag.activeBranchRef;
    const targetSha = this.drag.targetSha;
    const createIntent = this.drag.createIntent;

    this.resetDragSession();

    if (!activeBranchRef) {
      return;
    }

    if (!currentState || !targetSha) {
      this.render();
      return;
    }

    const intent = createIntent?.(targetSha) ?? null;
    if (!intent) {
      this.render();
      return;
    }

    this.previewRollbackState = currentState;
    this.renderedState = applyRebaseIntentToState(currentState, intent);
    this.awaitingHostSync = true;
    this.pendingAction = 'sync';
    this.render();
    this.revealPendingRebaseActions();
    this.postMessage({
      type: 'submitRebaseIntent',
      intent,
    });
  }

  handleWindowBlur(): void {
    this.resetDragSession();
  }

  private render(): void {
    if (!this.renderedState) {
      return;
    }

    renderStackView(this.elements.contentElement, this.renderedState, {
      pendingAction: this.pendingAction,
    });
  }

  private revealPendingRebaseActions(): void {
    if (!this.renderedState?.pendingRebase || this.drag.activeBranchRef) {
      return;
    }

    this.elements.contentElement
      .querySelector<HTMLElement>('.row[data-pending-rebase-root="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }

  private startDragSession(currentState: StackState, branchRef: string): void {
    const planner = createRebaseIntentPlanner(currentState, branchRef);
    this.drag.activeBranchRef = branchRef;
    this.drag.pendingBranchRef = null;
    this.drag.createIntent = planner.createIntent;
    this.drag.dropCandidates = collectDropCandidates(this.elements.contentElement);
    this.drag.dropRowsBySha = new Map(
      this.drag.dropCandidates.flatMap((candidate) =>
        candidate.rowElement ? [[candidate.sha, candidate.rowElement] as const] : []
      )
    );
    this.drag.validDropTargetShas = collectValidDropTargetShasWithPlanner(
      this.drag.dropCandidates,
      planner
    );
    this.drag.initialScrollTop = this.elements.viewportElement.scrollTop;
    this.elements.viewportElement.classList.add('dragging');
    document.body.classList.add('dragging-rebase');
  }

  private updateDropTarget(pointerY: number): void {
    if (!this.drag.activeBranchRef) {
      this.setDropTarget(null);
      return;
    }

    const scrollDelta =
      this.elements.viewportElement.scrollTop - this.drag.initialScrollTop;
    this.setDropTarget(
      resolveDropTarget(
        pointerY,
        this.drag.dropCandidates,
        this.drag.validDropTargetShas,
        scrollDelta
      )
    );
  }

  private setDropTarget(nextTargetSha: string | null): void {
    if (this.drag.targetSha === nextTargetSha) {
      return;
    }

    if (this.drag.targetSha) {
      this.getCommitRow(this.drag.targetSha)?.classList.remove('drop-target');
    }

    this.drag.targetSha = nextTargetSha;

    if (nextTargetSha) {
      this.getCommitRow(nextTargetSha)?.classList.add('drop-target');
    }
  }

  private ensureAutoScroll(): void {
    if (this.drag.autoScrollFrame !== null || !this.drag.activeBranchRef) {
      return;
    }

    this.drag.autoScrollFrame = window.requestAnimationFrame(() => {
      this.runAutoScroll();
    });
  }

  private runAutoScroll(): void {
    this.drag.autoScrollFrame = null;
    if (!this.drag.activeBranchRef) {
      return;
    }

    const viewportRect = this.elements.viewportElement.getBoundingClientRect();
    const distanceFromTop = this.drag.lastPointerY - viewportRect.top;
    const distanceFromBottom = viewportRect.bottom - this.drag.lastPointerY;

    let scrollDelta = 0;
    if (distanceFromTop < AUTO_SCROLL_EDGE_PX) {
      const proximity = distanceFromTop <= 0 ? 1 : 1 - distanceFromTop / AUTO_SCROLL_EDGE_PX;
      scrollDelta = -AUTO_SCROLL_MAX_SPEED * proximity;
    } else if (distanceFromBottom < AUTO_SCROLL_EDGE_PX) {
      const proximity =
        distanceFromBottom <= 0 ? 1 : 1 - distanceFromBottom / AUTO_SCROLL_EDGE_PX;
      scrollDelta = AUTO_SCROLL_MAX_SPEED * proximity;
    }

    if (scrollDelta !== 0) {
      this.elements.viewportElement.scrollBy(0, scrollDelta);
      this.updateDropTarget(this.drag.lastPointerY);
      this.drag.autoScrollFrame = window.requestAnimationFrame(() => {
        this.runAutoScroll();
      });
    }
  }

  private resetDragSession(): void {
    this.drag.pendingBranchRef = null;
    this.drag.activeBranchRef = null;
    this.drag.createIntent = null;
    this.drag.startX = 0;
    this.drag.startY = 0;
    this.drag.lastPointerY = 0;
    this.drag.dropCandidates.length = 0;
    this.drag.dropRowsBySha.clear();
    this.drag.validDropTargetShas.clear();
    this.drag.initialScrollTop = 0;
    this.setDropTarget(null);
    if (this.drag.autoScrollFrame !== null) {
      window.cancelAnimationFrame(this.drag.autoScrollFrame);
      this.drag.autoScrollFrame = null;
    }
    this.elements.viewportElement.classList.remove('dragging');
    document.body.classList.remove('dragging-rebase');
  }

  private handleActionClick(action: RebaseAction): void {
    switch (action) {
      case 'confirm-rebase':
        this.pendingAction = 'confirm';
        this.awaitingHostSync = true;
        this.render();
        this.postMessage({ type: 'confirmRebaseIntent' });
        return;
      case 'cancel-rebase':
        if (this.previewRollbackState) {
          this.renderedState = this.previewRollbackState;
        } else {
          this.pendingAction = 'cancel';
        }
        this.awaitingHostSync = true;
        this.render();
        this.postMessage({ type: 'cancelRebaseIntent' });
        return;
      case 'continue-rebase':
        this.pendingAction = 'continue';
        this.awaitingHostSync = true;
        this.render();
        this.postMessage({ type: 'continueRebase' });
        return;
      case 'abort-rebase':
        this.pendingAction = 'abort';
        this.awaitingHostSync = true;
        this.render();
        this.postMessage({ type: 'abortRebase' });
        return;
    }
  }

  private getCommitRow(commitSha: string): HTMLElement | null {
    return this.drag.dropRowsBySha.get(commitSha) ?? null;
  }
}

function isRebaseAction(action: string | undefined): action is RebaseAction {
  return (
    action === 'confirm-rebase' ||
    action === 'cancel-rebase' ||
    action === 'continue-rebase' ||
    action === 'abort-rebase'
  );
}

function isForcePushAction(action: string | undefined): action is ForcePushAction {
  return action === 'force-push-branch';
}

function isCreateBranchAction(action: string | undefined): action is CreateBranchAction {
  return action === 'create-branch-at-commit';
}

function isUncommittedAction(action: string | undefined): action is UncommittedAction {
  return action === 'amend-and-rebase' || action === 'branch-and-commit';
}

function parseBranchOverflowRefs(serialized: string | undefined): string[] {
  if (!serialized) {
    return [];
  }
  try {
    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function areStackStatesVisuallyEqual(left: StackState, right: StackState): boolean {
  if (
    left.error !== right.error ||
    left.current !== right.current ||
    left.trunk !== right.trunk ||
    !areRebaseIntentsEqual(left.pendingRebase, right.pendingRebase) ||
    !areActiveRebasesEqual(left.activeRebase, right.activeRebase) ||
    left.branches.length !== right.branches.length
  ) {
    return false;
  }

  for (let index = 0; index < left.branches.length; index += 1) {
    if (!areBranchesVisuallyEqual(left.branches[index], right.branches[index])) {
      return false;
    }
  }

  return true;
}

function areRebaseIntentsEqual(
  left: StackState['pendingRebase'],
  right: StackState['pendingRebase']
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.targetBaseSha === right.targetBaseSha &&
    left.targetBranchRef === right.targetBranchRef &&
    areIntentNodesEqual(left.root, right.root)
  );
}

function areActiveRebasesEqual(
  left: StackState['activeRebase'],
  right: StackState['activeRebase']
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.gitInProgress === right.gitInProgress &&
    left.queued === right.queued &&
    left.pendingStepCount === right.pendingStepCount &&
    left.headBranchRef === right.headBranchRef &&
    left.currentStep?.branchRef === right.currentStep?.branchRef &&
    left.currentStep?.label === right.currentStep?.label
  );
}

function areIntentNodesEqual(
  left: NonNullable<StackState['pendingRebase']>['root'],
  right: NonNullable<StackState['pendingRebase']>['root']
): boolean {
  if (
    left.branchRef !== right.branchRef ||
    left.headSha !== right.headSha ||
    left.baseSha !== right.baseSha ||
    left.children.length !== right.children.length
  ) {
    return false;
  }

  for (let index = 0; index < left.children.length; index += 1) {
    if (!areIntentNodesEqual(left.children[index], right.children[index])) {
      return false;
    }
  }

  return true;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function areCommitsEqual(
  left: StackState['branches'][number]['commits'],
  right: StackState['branches'][number]['commits']
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const commit = left[index];
    const other = right[index];
    if (
      commit.sha !== other.sha ||
      commit.message !== other.message ||
      commit.author !== other.author ||
      commit.timeMs !== other.timeMs ||
      commit.parentSha !== other.parentSha
    ) {
      return false;
    }
  }

  return true;
}

function areBranchesVisuallyEqual(
  left: StackState['branches'][number],
  right: StackState['branches'][number]
): boolean {
  return (
    left.ref === right.ref &&
    left.headSha === right.headSha &&
    left.baseSha === right.baseSha &&
    left.parentRef === right.parentRef &&
    left.isCurrent === right.isCurrent &&
    left.worktreePath === right.worktreePath &&
    left.worktreePeacockColor === right.worktreePeacockColor &&
    areStringArraysEqual(left.childRefs, right.childRefs) &&
    areCommitsEqual(left.commits, right.commits) &&
    arePullRequestsEqual(left.pullRequest, right.pullRequest)
  );
}

function arePullRequestsEqual(
  left: StackState['branches'][number]['pullRequest'],
  right: StackState['branches'][number]['pullRequest']
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.number === right.number &&
    left.url === right.url &&
    left.state === right.state &&
    left.isInSync === right.isInSync
  );
}
