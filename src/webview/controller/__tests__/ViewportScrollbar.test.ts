import { describe, expect, it } from 'vitest';
import { measureScrollbarMetrics } from '../ViewportScrollbar';

describe('measureScrollbarMetrics', () => {
  it('hides the thumb when content fits in the viewport', () => {
    expect(
      measureScrollbarMetrics({
        viewportSize: 320,
        contentSize: 320,
        scrollOffset: 0,
        trackSize: 320,
      })
    ).toEqual({
      isVisible: false,
      thumbSize: 0,
      thumbOffset: 0,
      maxScrollOffset: 0,
      maxThumbOffset: 0,
    });
  });

  it('computes a proportional square thumb offset', () => {
    expect(
      measureScrollbarMetrics({
        viewportSize: 200,
        contentSize: 1000,
        scrollOffset: 400,
        trackSize: 200,
      })
    ).toEqual({
      isVisible: true,
      thumbSize: 40,
      thumbOffset: 80,
      maxScrollOffset: 800,
      maxThumbOffset: 160,
    });
  });

  it('enforces the minimum thumb size', () => {
    expect(
      measureScrollbarMetrics({
        viewportSize: 120,
        contentSize: 4000,
        scrollOffset: 1940,
        trackSize: 120,
      })
    ).toEqual({
      isVisible: true,
      thumbSize: 24,
      thumbOffset: 48,
      maxScrollOffset: 3880,
      maxThumbOffset: 96,
    });
  });
});
