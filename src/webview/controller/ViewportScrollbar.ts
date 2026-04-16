export interface ViewportScrollbarElements {
  rootElement: HTMLElement;
  viewportElement: HTMLElement;
  trackElement: HTMLElement;
  thumbElement: HTMLElement;
}

export interface ScrollbarMetricsInput {
  viewportSize: number;
  contentSize: number;
  scrollOffset: number;
  trackSize: number;
  minThumbSize?: number;
}

export interface ScrollbarMetrics {
  isVisible: boolean;
  thumbSize: number;
  thumbOffset: number;
  maxScrollOffset: number;
  maxThumbOffset: number;
}

const DEFAULT_MIN_THUMB_SIZE = 24;

export function measureScrollbarMetrics(
  input: ScrollbarMetricsInput
): ScrollbarMetrics {
  const maxScrollOffset = Math.max(0, input.contentSize - input.viewportSize);
  if (input.viewportSize <= 0 || input.trackSize <= 0 || maxScrollOffset <= 0) {
    return {
      isVisible: false,
      thumbSize: 0,
      thumbOffset: 0,
      maxScrollOffset,
      maxThumbOffset: 0,
    };
  }

  const minThumbSize = input.minThumbSize ?? DEFAULT_MIN_THUMB_SIZE;
  const proportionalThumbSize = (input.viewportSize / input.contentSize) * input.trackSize;
  const thumbSize = Math.min(
    input.trackSize,
    Math.max(minThumbSize, Math.round(proportionalThumbSize))
  );
  const maxThumbOffset = Math.max(0, input.trackSize - thumbSize);
  const clampedScrollOffset = Math.min(maxScrollOffset, Math.max(0, input.scrollOffset));
  const thumbOffset =
    maxScrollOffset === 0 ? 0 : Math.round((clampedScrollOffset / maxScrollOffset) * maxThumbOffset);

  return {
    isVisible: true,
    thumbSize,
    thumbOffset,
    maxScrollOffset,
    maxThumbOffset,
  };
}

export class ViewportScrollbar {
  private dragPointerId: number | null = null;
  private dragOffsetWithinThumb = 0;
  private hideTimer: number | null = null;
  private isHovered = false;
  private isVisible = false;
  private lastMetrics: ScrollbarMetrics = {
    isVisible: false,
    thumbSize: 0,
    thumbOffset: 0,
    maxScrollOffset: 0,
    maxThumbOffset: 0,
  };

  constructor(private readonly elements: ViewportScrollbarElements) {
    this.elements.trackElement.addEventListener('pointerdown', this.handlePointerDown);
    this.elements.rootElement.addEventListener('pointerenter', this.handlePointerEnter);
    this.elements.rootElement.addEventListener('pointerleave', this.handlePointerLeave);
    this.elements.viewportElement.addEventListener('scroll', this.handleViewportScroll, {
      passive: true,
    });
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.sync();
  }

  sync(): void {
    this.lastMetrics = measureScrollbarMetrics({
      viewportSize: this.elements.viewportElement.clientHeight,
      contentSize: this.elements.viewportElement.scrollHeight,
      scrollOffset: this.elements.viewportElement.scrollTop,
      trackSize: this.elements.trackElement.clientHeight,
    });

    this.elements.trackElement.classList.toggle('hidden', !this.lastMetrics.isVisible);
    this.elements.thumbElement.style.height = `${this.lastMetrics.thumbSize}px`;
    this.elements.thumbElement.style.transform = `translateY(${this.lastMetrics.thumbOffset}px)`;
    this.updateVisibility();
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.lastMetrics.isVisible) {
      return;
    }

    const trackRect = this.elements.trackElement.getBoundingClientRect();
    const pointerOffsetInTrack = event.clientY - trackRect.top;
    const clickedThumb = event.target === this.elements.thumbElement;

    if (clickedThumb) {
      this.dragOffsetWithinThumb = pointerOffsetInTrack - this.lastMetrics.thumbOffset;
    } else {
      const centeredThumbOffset = pointerOffsetInTrack - this.lastMetrics.thumbSize / 2;
      this.scrollViewportFromThumbOffset(centeredThumbOffset);
      this.sync();
      this.dragOffsetWithinThumb = this.lastMetrics.thumbSize / 2;
    }

    this.dragPointerId = event.pointerId;
    this.elements.thumbElement.classList.add('dragging');
    this.elements.trackElement.classList.add('dragging');
    this.elements.trackElement.setPointerCapture?.(event.pointerId);
    this.show();
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId || !this.lastMetrics.isVisible) {
      return;
    }

    const trackRect = this.elements.trackElement.getBoundingClientRect();
    const nextThumbOffset =
      event.clientY - trackRect.top - this.dragOffsetWithinThumb;
    this.scrollViewportFromThumbOffset(nextThumbOffset);
    this.sync();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) {
      return;
    }

    this.dragPointerId = null;
    this.elements.thumbElement.classList.remove('dragging');
    this.elements.trackElement.classList.remove('dragging');
    this.updateVisibility();
  };

  private handlePointerEnter = (): void => {
    this.isHovered = true;
    this.show();
  };

  private handlePointerLeave = (): void => {
    this.isHovered = false;
    this.updateVisibility();
  };

  private handleViewportScroll = (): void => {
    this.showTemporarily();
  };

  private handleWindowBlur = (): void => {
    this.isHovered = false;
    this.dragPointerId = null;
    this.clearHideTimer();
    this.elements.thumbElement.classList.remove('dragging');
    this.elements.trackElement.classList.remove('dragging');
    this.setVisible(false);
  };

  private scrollViewportFromThumbOffset(thumbOffset: number): void {
    const clampedThumbOffset = Math.min(
      this.lastMetrics.maxThumbOffset,
      Math.max(0, thumbOffset)
    );
    const nextScrollTop =
      this.lastMetrics.maxThumbOffset === 0
        ? 0
        : (clampedThumbOffset / this.lastMetrics.maxThumbOffset) *
          this.lastMetrics.maxScrollOffset;
    this.elements.viewportElement.scrollTop = nextScrollTop;
  }

  private showTemporarily(): void {
    this.show();
    if (this.dragPointerId !== null || this.isHovered) {
      return;
    }

    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.updateVisibility();
    }, 420);
  }

  private show(): void {
    this.clearHideTimer();
    this.setVisible(true);
  }

  private updateVisibility(): void {
    const shouldBeVisible =
      this.lastMetrics.isVisible && (this.isHovered || this.dragPointerId !== null);
    if (shouldBeVisible) {
      this.show();
      return;
    }

    if (this.hideTimer !== null) {
      return;
    }

    this.setVisible(false);
  }

  private setVisible(nextVisible: boolean): void {
    if (this.isVisible === nextVisible) {
      return;
    }

    this.isVisible = nextVisible;
    this.elements.rootElement.classList.toggle('scrollbar-visible', nextVisible);
  }

  private clearHideTimer(): void {
    if (this.hideTimer === null) {
      return;
    }

    window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
