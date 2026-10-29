import { describe, expect, it } from 'vitest';
import {
  getVisibleWebImeiServiceTierKeys,
  hasAdditionalWebImeiServiceTierKeys,
} from './imei-checker-visible-tiers';

describe('getVisibleWebImeiServiceTierKeys', () => {
  it('returns the collapsed primary tiers for the smartphone/apple default', () => {
    const keys = getVisibleWebImeiServiceTierKeys('smartphone', 'apple', false);
    expect(keys).toEqual(['full', 'basic', 'blacklist', 'carrier']);
  });

  it('returns the full non-apple brand list without collapsing (short-list rule)', () => {
    const keys = getVisibleWebImeiServiceTierKeys(
      'smartphone',
      'samsung',
      false
    );
    expect(keys).toContain('samsung');
    expect(keys).toContain('samsungPro');
    expect(keys).toContain('knoxGuard');
  });

  it('returns the laptop-scoped serial tiers', () => {
    const keys = getVisibleWebImeiServiceTierKeys('laptop', 'apple', false);
    expect(keys).toEqual(['macIcloud', 'activation', 'mdm', 'gsxPremium']);
  });

  it('expands to reveal additional tiers beyond the collapsed set', () => {
    const collapsed = getVisibleWebImeiServiceTierKeys(
      'smartphone',
      'apple',
      false
    );
    const expanded = getVisibleWebImeiServiceTierKeys(
      'smartphone',
      'apple',
      true
    );
    expect(expanded.length).toBeGreaterThan(collapsed.length);
  });
});

describe('hasAdditionalWebImeiServiceTierKeys', () => {
  it('is true when the smartphone/apple tab has more to reveal', () => {
    expect(hasAdditionalWebImeiServiceTierKeys('smartphone', 'apple')).toBe(
      true
    );
  });
});
