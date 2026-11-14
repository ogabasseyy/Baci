import { describe, expect, it } from 'vitest';
import { isRestrictedWifiOnlyVariant } from './restricted-wifi-variant';

describe('restricted-wifi-variant', () => {
  it('detects Wi-Fi only connectivity and SIM types', () => {
    expect(
      isRestrictedWifiOnlyVariant({ attributes: { sim_type: 'Wi-Fi Only' } })
    ).toBe(true);
    expect(
      isRestrictedWifiOnlyVariant({ attributes: { 'SIM Type': 'Wifi Only' } })
    ).toBe(true);
    expect(
      isRestrictedWifiOnlyVariant({
        attributes: { connectivity: 'wifi-only' },
      })
    ).toBe(true);
  });

  it('allows cellular and unspecified variants', () => {
    expect(
      isRestrictedWifiOnlyVariant({
        attributes: { sim_type: 'Physical + eSIM' },
      })
    ).toBe(false);
    expect(isRestrictedWifiOnlyVariant({ attributes: null })).toBe(false);
    expect(isRestrictedWifiOnlyVariant({})).toBe(false);
  });
});
