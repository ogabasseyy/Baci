import { describe, expect, it } from 'vitest';
import { stripProviderNames } from './strip-provider-names';

describe('stripProviderNames', () => {
  it('removes bracketed, dashed, joined and bare provider names', () => {
    expect(stripProviderNames('Ikeja Electric (Kuda)')).toBe('Ikeja Electric');
    expect(stripProviderNames('Prepaid [Monnify]')).toBe('Prepaid');
    expect(stripProviderNames('Ikeja Electric - Kuda')).toBe('Ikeja Electric');
    expect(stripProviderNames('Top-up via Paystack')).toBe('Top-up');
    expect(stripProviderNames('(Paystack) top-up')).toBe('top-up');
  });

  it('keeps networks, billers and ordinary text', () => {
    for (const text of [
      'MTN',
      'Ikeja Electric',
      'Airtime - MTN 0800',
      'DStv Compact',
    ]) {
      expect(stripProviderNames(text)).toBe(text);
    }
  });
});
