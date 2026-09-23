import { describe, expect, it } from 'vitest';
import { getJumiaManualOrderCacheKey } from './get-jumia-manual-order-cache-key';

describe('getJumiaManualOrderCacheKey', () => {
  it('preserves the selected marketplace scope', () => {
    expect(getJumiaManualOrderCacheKey('Jumia Nigeria')).toBe('Jumia Nigeria');
  });

  it('trims surrounding whitespace from the selected scope', () => {
    expect(getJumiaManualOrderCacheKey('  Jumia Nigeria  ')).toBe(
      'Jumia Nigeria'
    );
  });

  it('falls back to the neutral scope for missing or blank keys', () => {
    expect(getJumiaManualOrderCacheKey(undefined)).toBe('default');
    expect(getJumiaManualOrderCacheKey(null)).toBe('default');
    expect(getJumiaManualOrderCacheKey('')).toBe('default');
    expect(getJumiaManualOrderCacheKey('   ')).toBe('default');
    expect(getJumiaManualOrderCacheKey('default')).toBe('default');
  });
});
