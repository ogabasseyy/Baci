import { describe, expect, it } from 'vitest';
import { normalizeKudaItemCode } from './kuda-item-code';

describe('normalizeKudaItemCode', () => {
  it.each([
    ['KUD-CAB-DST-1', 'kudcabdst1'],
    [' kud cab dst 1 ', 'kudcabdst1'],
    ['Kud_Cab.Dst/1', 'kudcabdst1'],
  ])('normalizes %j', (code, expected) => {
    expect(normalizeKudaItemCode(code)).toBe(expected);
  });

  it('returns an empty string for punctuation only', () => {
    expect(normalizeKudaItemCode(' -_ ')).toBe('');
  });
});
