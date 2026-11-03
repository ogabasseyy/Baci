import { describe, expect, it } from 'vitest';
import {
  hasConnectivityValue,
  isWifiOnlyConnectivity,
} from './fast-catalog-wifi';

describe('catalog connectivity evidence', () => {
  it.each([
    'WiFi',
    'Wi-Fi Only',
    'Wi Fi only',
  ])('recognizes %s as Wi-Fi-only', (value) => {
    expect(isWifiOnlyConnectivity({ sim_type: value })).toBe(true);
  });

  it('does not treat cellular or conflicting SIM evidence as Wi-Fi-only', () => {
    expect(isWifiOnlyConnectivity({ connectivity: 'WiFi+Cellular' })).toBe(
      false
    );
    expect(
      isWifiOnlyConnectivity({ connectivity: 'WiFi', sim_type: 'Physical SIM' })
    ).toBe(false);
    expect(hasConnectivityValue({ connectivity: 'WiFi+Cellular' })).toBe(true);
    expect(hasConnectivityValue({ color: 'Blue', sim_type: '' })).toBe(false);
  });
});
