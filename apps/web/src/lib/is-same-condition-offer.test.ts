import { describe, expect, it } from 'vitest';
import { isSameConditionOffer } from './is-same-condition-offer';

describe('isSameConditionOffer', () => {
  it('matches offer rows that carry the parent condition', () => {
    expect(isSameConditionOffer('New', 'new')).toBe(true);
    expect(isSameConditionOffer('uk_used', 'Used')).toBe(true);
  });

  it('keeps offers with a different condition than the parent', () => {
    expect(isSameConditionOffer('used', 'new')).toBe(false);
    expect(isSameConditionOffer('used', null)).toBe(false);
  });

  it('keeps rows with an unknown condition fail-open', () => {
    expect(isSameConditionOffer('weird-grade', 'new')).toBe(false);
    expect(isSameConditionOffer(null, 'new')).toBe(false);
    expect(isSameConditionOffer(undefined, undefined)).toBe(false);
  });

  it('defaults a null parent condition to new like the PDP', () => {
    expect(isSameConditionOffer('new', null)).toBe(true);
    expect(isSameConditionOffer('New', undefined)).toBe(true);
    expect(isSameConditionOffer('used', null)).toBe(false);
  });
});
