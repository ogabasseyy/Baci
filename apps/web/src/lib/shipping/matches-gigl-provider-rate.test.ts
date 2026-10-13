import { describe, expect, it } from 'vitest';
import { matchesGiglProviderRate } from './matches-gigl-provider-rate';

describe('matchesGiglProviderRate', () => {
  it('matches a legacy pickup-centre ID to its sender-bound replacement', () => {
    expect(
      matchesGiglProviderRate('GIGL_30_1_1_575_0', 'GIGL_30_1_1_575_0_4')
    ).toBe(true);
  });

  it('does not match a different pickup centre', () => {
    expect(
      matchesGiglProviderRate('GIGL_30_1_1_575_0', 'GIGL_30_1_1_576_0_4')
    ).toBe(false);
  });

  it('does not treat international or malformed IDs as domestic matches', () => {
    expect(
      matchesGiglProviderRate('GIGL_INTL_2_0_0_1', 'GIGL_INTL_2_0_0_1')
    ).toBe(false);
    expect(matchesGiglProviderRate('GIGL_bad', 'GIGL_bad')).toBe(false);
  });
});
