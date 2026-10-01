import { describe, expect, it } from 'vitest';
import { isNetworkDeviceCategory } from './is-network-device-category';

describe('isNetworkDeviceCategory', () => {
  it('recognizes cellular connectivity device categories', () => {
    for (const category of [
      'Cellular Routers',
      'MiFi',
      'Mobile Hotspot',
      '4G Modem',
    ]) {
      expect(isNetworkDeviceCategory(category)).toBe(true);
    }
  });

  it('does not classify unrelated networking accessories as cellular devices', () => {
    expect(isNetworkDeviceCategory('Wi-Fi Routers')).toBe(false);
    expect(isNetworkDeviceCategory('Ethernet Cables')).toBe(false);
  });
});
