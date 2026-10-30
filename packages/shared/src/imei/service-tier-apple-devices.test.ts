import { describe, expect, it } from 'vitest';
import { APPLE_DEVICE_IMEI_SERVICE_TIERS } from './service-tier-apple-devices';
import { isImeiServiceTierKey } from './service-tiers';

const tiers = Object.entries(APPLE_DEVICE_IMEI_SERVICE_TIERS);

describe('APPLE_DEVICE_IMEI_SERVICE_TIERS', () => {
  it('registers every device tier in the shared catalog', () => {
    for (const [key] of tiers) {
      expect(isImeiServiceTierKey(key)).toBe(true);
    }
  });

  it('is Apple-scoped, device-tagged and priced on every tier', () => {
    for (const [, tier] of tiers) {
      expect(tier.brandScopes).toEqual(['apple']);
      expect(tier.deviceCategories.length).toBeGreaterThan(0);
      expect(['imei', 'serial', 'both']).toContain(tier.identifier);
      expect(tier.price).toBeGreaterThan(0);
      expect(tier.providerServiceId).not.toBe('');
      expect(tier.checksIncluded.length).toBeGreaterThan(0);
    }
  });

  it('scopes the Mac iCloud lock check to serial-only laptops', () => {
    const macIcloud = APPLE_DEVICE_IMEI_SERVICE_TIERS.macIcloud;
    expect(macIcloud.deviceCategories).toEqual(['laptop']);
    // Macs have no IMEI — accepting IMEI-shaped input would doom the lookup.
    expect(macIcloud.identifier).toBe('serial');
  });

  it('keeps GSX premium available across all Apple device families', () => {
    const gsx = APPLE_DEVICE_IMEI_SERVICE_TIERS.gsxPremium;
    expect(gsx.identifier).toBe('serial');
    for (const category of ['smartphone', 'tablet', 'laptop', 'watch']) {
      expect(gsx.deviceCategories).toContain(category);
    }
  });
});
