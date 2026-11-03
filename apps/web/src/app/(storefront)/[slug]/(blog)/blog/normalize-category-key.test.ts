import { describe, expect, it } from 'vitest';
import { normalizeCategoryKey } from './normalize-category-key';

describe('normalizeCategoryKey', () => {
  it('lowercases, trims, and hyphenates category labels', () => {
    expect(normalizeCategoryKey('  Smart Phones & Tablets ')).toBe(
      'smart-phones-and-tablets'
    );
  });

  it('collapses repeated separators and strips edge hyphens', () => {
    expect(normalizeCategoryKey('--Home___Audio--')).toBe('home-audio');
  });

  it('expands ampersands and drops separator-only labels', () => {
    expect(normalizeCategoryKey(' & ')).toBe('and');
    expect(normalizeCategoryKey('---')).toBe('');
  });
});
