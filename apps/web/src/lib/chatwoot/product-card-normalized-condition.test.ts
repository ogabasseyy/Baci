import { describe, expect, it } from 'vitest';
import { normalizedCondition } from './product-card-normalized-condition';

describe('normalizedCondition', () => {
  it('normalises only supported conditions', () => {
    expect(normalizedCondition('new')).toBe('new');
    expect(normalizedCondition('used')).toBe('used');
    expect(normalizedCondition(5)).toBeUndefined();
    expect(normalizedCondition('mystery')).toBeUndefined();
  });
});
