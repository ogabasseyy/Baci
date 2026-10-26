import { describe, expect, it } from 'vitest';
import { normalizeInferredBrands } from './normalize-inferred-brands';

describe('normalizeInferredBrands', () => {
  describe('normalizeInferredBrands', () => {
    it('deduplicates brands that map to the same canonical key', () => {
      const result = normalizeInferredBrands('smartphones', [
        'Xiaomi',
        'Redmi',
        'xiaomi',
      ]);
      expect(result).toEqual(['xiaomi']);
    });

    it('drops generic tokens but keeps brands sharing their category slug', () => {
      expect(
        normalizeInferredBrands('gaming', ['playstation', 'gaming'])
      ).toEqual(['playstation']);
      expect(normalizeInferredBrands('xbox', ['xbox'])).toEqual(['xbox']);
    });

    it('filters out empty or invalid brand tokens', () => {
      const result = normalizeInferredBrands('smartphones', [
        'Samsung',
        '',
        '   ',
        'Apple',
      ]);
      expect(result).toEqual(['samsung', 'apple']);
    });
  });
});
