import { describe, expect, it } from 'vitest';
import { PushExpectationStore } from '../pushExpectationStore';

describe('PushExpectationStore', () => {
  it('records and retrieves an expectation', () => {
    const store = new PushExpectationStore(() => 1000);
    store.record('feature', 'sha1', 'main');

    const got = store.get('feature');
    expect(got).toMatchObject({ expectedHeadSha: 'sha1', expectedBaseRef: 'main' });
    expect(store.hasActiveFor('feature')).toBe(true);
  });

  it('returns null once the expectation has expired', () => {
    let now = 1000;
    const store = new PushExpectationStore(() => now);
    store.record('feature', 'sha1', null);

    now = 1000 + PushExpectationStore.TTL_MS;
    expect(store.get('feature')).toBeNull();
    expect(store.hasActiveFor('feature')).toBe(false);
  });

  it('clear removes the expectation', () => {
    const store = new PushExpectationStore(() => 1000);
    store.record('feature', 'sha1', null);
    store.clear('feature');
    expect(store.get('feature')).toBeNull();
  });

  it('records a synthetic pull payload alongside the expectation', () => {
    const store = new PushExpectationStore(() => 1000);
    const syntheticPull = { number: 42 } as never;
    store.record('feature', 'sha1', 'main', syntheticPull);

    const snap = store.snapshot();
    expect(snap.get('feature')?.syntheticPull).toBe(syntheticPull);
  });

  it('record overwrites an existing expectation for the same branch', () => {
    let now = 1000;
    const store = new PushExpectationStore(() => now);
    store.record('feature', 'sha1', 'main');

    now = 5000;
    store.record('feature', 'sha2', 'develop');

    expect(store.get('feature')).toMatchObject({
      expectedHeadSha: 'sha2',
      expectedBaseRef: 'develop',
    });
  });

  it('snapshot omits expired entries and returns a view without expiresAt', () => {
    let now = 1000;
    const store = new PushExpectationStore(() => now);
    store.record('older', 'sha-older', null);

    now = 5000;
    store.record('newer', 'sha-newer', null);

    // Both still alive.
    now = 5000;
    const snap = store.snapshot();
    expect(snap.get('older')).toEqual({
      expectedHeadSha: 'sha-older',
      expectedBaseRef: null,
      syntheticPull: null,
    });
    expect(snap.get('newer')).toEqual({
      expectedHeadSha: 'sha-newer',
      expectedBaseRef: null,
      syntheticPull: null,
    });

    // 'older' has expired, 'newer' still alive.
    now = 1000 + PushExpectationStore.TTL_MS + 1;
    const snap2 = store.snapshot();
    expect(snap2.has('older')).toBe(false);
    expect(snap2.get('newer')).toBeDefined();
  });
});
