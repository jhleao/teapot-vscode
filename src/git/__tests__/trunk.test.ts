import { describe, expect, it } from 'vitest';
import { selectTrunk } from '../trunk';

describe('selectTrunk', () => {
  it('prefers canonical trunk names in priority order', () => {
    expect(selectTrunk(['feature/demo', 'develop', 'master'])).toBe('master');
    expect(selectTrunk(['trunk', 'develop', 'main'])).toBe('main');
  });

  it('returns null when no trunk candidate exists', () => {
    expect(selectTrunk(['feature/demo', 'bugfix/foo'])).toBeNull();
  });
});
