import { describe, expect, it } from 'vitest';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

describe('resolveCanonicalBrandKey', () => {
  describe('resolveCanonicalBrandKey', () => {
    it('maps taxonomy aliases such as Redmi to canonical brand key xiaomi', () => {
      expect(resolveCanonicalBrandKey('smartphones', 'Redmi')).toBe('xiaomi');
      expect(resolveCanonicalBrandKey('smartphones', 'Xiaomi')).toBe('xiaomi');
    });

    it('maps known brands to their canonical brandKey', () => {
      expect(resolveCanonicalBrandKey('smartphones', 'Samsung')).toBe(
        'samsung'
      );
      expect(resolveCanonicalBrandKey('smartphones', 'Apple')).toBe('apple');
      expect(resolveCanonicalBrandKey('smartphones', 'Google')).toBe('google');
    });

    it('falls back to slugified brand name for uncurated brands', () => {
      expect(resolveCanonicalBrandKey('smartphones', 'OnePlus')).toBe(
        'oneplus'
      );
      expect(resolveCanonicalBrandKey('smartphones', 'Nothing Phone')).toBe(
        'nothing-phone'
      );
    });

    it('returns empty string for null, undefined, or empty brand', () => {
      expect(resolveCanonicalBrandKey('smartphones', null)).toBe('');
      expect(resolveCanonicalBrandKey('smartphones', undefined)).toBe('');
      expect(resolveCanonicalBrandKey('smartphones', '   ')).toBe('');
    });
  });
});
