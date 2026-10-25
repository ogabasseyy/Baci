import { describe, expect, it } from 'vitest';
import { resolveInputIdentifier } from './identifier';
import {
  ALL_IMEI_SERVICE_TIERS,
  getVisibleImeiServiceTierKeys,
  getVisibleImeiServiceTierKeysForDevice,
  hasAdditionalImeiServiceTierKeysForDevice,
  IMEI_DEVICE_CATEGORIES,
  IMEI_IDENTIFIER_BY_DEVICE,
  IMEI_SERVICE_TIERS,
  imeiTierMatchesBrand,
  imeiTierMatchesDevice,
  isImeiServiceTierKey,
  PETROCK_DARK_IMEI_SERVICE_TIERS,
  PUBLIC_IMEI_SERVICE_TIERS,
  RECOMMENDED_TIER_BY_DEVICE,
} from './service-tiers';

describe('IMEI service tiers', () => {
  it('keeps Full Report pricing and provider id in the shared catalog', () => {
    expect(IMEI_SERVICE_TIERS.full).toMatchObject({
      name: 'Full Report',
      price: 1500,
      providerServiceId: '61',
      recommended: true,
    });
  });

  it('exposes only primary service cards before expansion', () => {
    expect(getVisibleImeiServiceTierKeys('apple', false)).toEqual([
      'full',
      'basic',
      'blacklist',
      'carrier',
    ]);
  });

  it('filters brand-scoped services for expanded Apple checks', () => {
    const appleTiers = getVisibleImeiServiceTierKeys('apple', true);

    expect(appleTiers).toContain('activation');
    expect(appleTiers).toContain('carrier');
    expect(appleTiers).not.toContain('samsung');
  });

  it('keeps every tier executable and priced', () => {
    for (const tierKey of ALL_IMEI_SERVICE_TIERS) {
      const tier = IMEI_SERVICE_TIERS[tierKey];

      expect(isImeiServiceTierKey(tierKey)).toBe(true);
      expect(tier.providerServiceId).not.toBe('');
      expect(tier.price).toBeGreaterThan(0);
      expect(tier.features.length).toBeGreaterThan(0);
      expect(tier.checksIncluded.length).toBeGreaterThan(0);
    }
  });

  it('declares a device category and identifier for every tier', () => {
    for (const tierKey of ALL_IMEI_SERVICE_TIERS) {
      const tier = IMEI_SERVICE_TIERS[tierKey];
      expect(tier.deviceCategories.length).toBeGreaterThan(0);
      expect(['imei', 'serial', 'both']).toContain(tier.identifier);
    }
  });

  it('pins every Android tier to IMEI-only input (Sickw rejects serials)', () => {
    const androidTiers = [
      'samsung',
      'samsungPro',
      'knoxGuard',
      'miLock',
      'miLostPro',
      'pixel',
      'oppoRealme',
      'transsion',
    ] as const;

    for (const tierKey of androidTiers) {
      expect(IMEI_SERVICE_TIERS[tierKey].identifier).toBe('imei');
    }
  });

  it('prices new services on the shared ~₦16,350/$ markup curve', () => {
    // Spot-check a few new tiers stay within the existing markup band.
    for (const key of ['macIcloud', 'gsxPremium', 'knoxGuard'] as const) {
      const tier = IMEI_SERVICE_TIERS[key];
      const ratio = tier.price / tier.costUsd;
      expect(ratio).toBeGreaterThan(14_000);
      expect(ratio).toBeLessThan(20_000);
    }
  });

  it('recognizes every real tier key and rejects invalid values', () => {
    for (const tierKey of ALL_IMEI_SERVICE_TIERS) {
      expect(isImeiServiceTierKey(tierKey)).toBe(true);
    }

    expect(isImeiServiceTierKey('invalid-key')).toBe(false);
    expect(isImeiServiceTierKey('__proto__')).toBe(false);
    expect(isImeiServiceTierKey('toString')).toBe(false);
    expect(isImeiServiceTierKey('')).toBe(false);
    expect(isImeiServiceTierKey(null)).toBe(false);
  });

  it('matches brand filters against universal and scoped tiers', () => {
    // Universal ('all' scope) tiers match every brand chip.
    expect(imeiTierMatchesBrand('blacklist', 'apple')).toBe(true);
    expect(imeiTierMatchesBrand('blacklist', 'samsung')).toBe(true);
    // Scoped tiers only match their own brand.
    expect(imeiTierMatchesBrand('full', 'apple')).toBe(true);
    expect(imeiTierMatchesBrand('samsung', 'samsung')).toBe(true);
    expect(imeiTierMatchesBrand('samsung', 'apple')).toBe(false);
  });

  it('declares Xiaomi lock and lost verdict fields for paid Mi tiers', () => {
    expect(IMEI_SERVICE_TIERS.miLock.checksIncluded).toContain('miLockStatus');
    expect(IMEI_SERVICE_TIERS.miLostPro.checksIncluded).toEqual(
      expect.arrayContaining(['miLockStatus', 'miLostStatus'])
    );
  });

  it('declares MDM status output for the Apple MDM tier', () => {
    expect(IMEI_SERVICE_TIERS.mdm.checksIncluded).toContain('mdmStatus');
  });

  it('ships serial-only Apple services now that serial-input mode exists', () => {
    for (const key of ['serialInfo', 'replacementHistory'] as const) {
      expect(isImeiServiceTierKey(key)).toBe(true);
      expect(IMEI_SERVICE_TIERS[key].identifier).toBe('serial');
    }
  });

  it('maps each device category to an input identifier', () => {
    for (const { id } of IMEI_DEVICE_CATEGORIES) {
      expect(IMEI_IDENTIFIER_BY_DEVICE[id]).toBeDefined();
    }
    // Phones must stay 'both' (not 'imei') so a shared 'both' Apple tier keeps
    // accepting an iPhone serial on the phone tab; a revert to 'imei' would
    // block serial input for activation/mdm/demoUnit.
    expect(IMEI_IDENTIFIER_BY_DEVICE.smartphone).toBe('both');
    expect(IMEI_IDENTIFIER_BY_DEVICE.laptop).toBe('serial');
    expect(IMEI_IDENTIFIER_BY_DEVICE.watch).toBe('serial');
    expect(IMEI_IDENTIFIER_BY_DEVICE.tablet).toBe('both');
  });

  it('keeps a both-tier flexible on the phone tab but serial-only on laptop/watch', () => {
    // Regression: a 'both' Apple tier (e.g. activation) must still accept a
    // serial on the phone tab, while laptop/watch narrow it to serial-only.
    expect(
      resolveInputIdentifier('both', IMEI_IDENTIFIER_BY_DEVICE.smartphone)
    ).toBe('both');
    expect(
      resolveInputIdentifier('both', IMEI_IDENTIFIER_BY_DEVICE.laptop)
    ).toBe('serial');
    expect(
      resolveInputIdentifier('both', IMEI_IDENTIFIER_BY_DEVICE.watch)
    ).toBe('serial');
  });

  it('scopes device-aware tiers to the requested hardware family', () => {
    const laptopTiers = getVisibleImeiServiceTierKeysForDevice(
      'laptop',
      'apple',
      true
    );
    expect(laptopTiers).toContain('macIcloud');
    expect(laptopTiers).not.toContain('carrier'); // iPhone-only
    expect(laptopTiers).not.toContain('samsung');
    for (const key of laptopTiers) {
      expect(imeiTierMatchesDevice(key, 'laptop')).toBe(true);
    }
  });

  it('recommends a valid, device-matching flagship per category', () => {
    for (const { id } of IMEI_DEVICE_CATEGORIES) {
      const recommended = RECOMMENDED_TIER_BY_DEVICE[id];
      expect(isImeiServiceTierKey(recommended)).toBe(true);
      expect(imeiTierMatchesDevice(recommended, id)).toBe(true);
    }
  });

  it('reports when a device+brand has extra services behind the toggle', () => {
    expect(
      hasAdditionalImeiServiceTierKeysForDevice('smartphone', 'apple')
    ).toBe(true);
  });

  it('shows a non-Apple brand its own checks without needing "show all"', () => {
    const samsungCollapsed = getVisibleImeiServiceTierKeysForDevice(
      'smartphone',
      'samsung',
      false
    );
    expect(samsungCollapsed).toEqual(
      expect.arrayContaining(['samsung', 'samsungPro', 'knoxGuard'])
    );
    expect(samsungCollapsed).not.toContain('full'); // iPhone-only

    // Each Android sub-brand is its own chip now (Samsung is Android too).
    expect(
      getVisibleImeiServiceTierKeysForDevice('smartphone', 'google', false)
    ).toContain('pixel');
    expect(
      getVisibleImeiServiceTierKeysForDevice('smartphone', 'xiaomi', false)
    ).toEqual(expect.arrayContaining(['miLock', 'miLostPro']));
    expect(
      getVisibleImeiServiceTierKeysForDevice('smartphone', 'oppo', false)
    ).toContain('oppoRealme');
    expect(
      getVisibleImeiServiceTierKeysForDevice('smartphone', 'tecno', false)
    ).toContain('transsion');
  });

  it('reveals more services when expanded', () => {
    const collapsed = getVisibleImeiServiceTierKeys('apple', false);
    const expanded = getVisibleImeiServiceTierKeys('apple', true);

    expect(expanded.length).toBeGreaterThan(collapsed.length);
    for (const key of collapsed) {
      expect(expanded).toContain(key);
    }
  });

  it('catalogs Phase 3 Petrock-only checks while keeping every one dark', () => {
    expect(PETROCK_DARK_IMEI_SERVICE_TIERS).toEqual(
      expect.arrayContaining([
        'esimCompatibility',
        'attFinance',
        'tmobileFinance',
        'verizonFinance',
        'knoxEnrollment',
        'samsungSoldBy',
        'macPhotoReport',
        'applePremiumMax',
        'tracfoneFinance',
        'xfinityFinance',
      ])
    );

    for (const tierKey of PETROCK_DARK_IMEI_SERVICE_TIERS) {
      expect(isImeiServiceTierKey(tierKey)).toBe(true);
      expect(PUBLIC_IMEI_SERVICE_TIERS).not.toContain(tierKey);
      expect(IMEI_SERVICE_TIERS[tierKey].price).toBeGreaterThan(0);
    }
  });

  it('declares the new parser fields on their matching dark tiers', () => {
    expect(IMEI_SERVICE_TIERS.esimCompatibility.checksIncluded).toContain(
      'esimCompatibility'
    );
    expect(IMEI_SERVICE_TIERS.attFinance.checksIncluded).toContain(
      'financeStatus'
    );
    expect(IMEI_SERVICE_TIERS.knoxEnrollment.checksIncluded).toContain(
      'knoxEnrollment'
    );
    expect(IMEI_SERVICE_TIERS.samsungSoldBy.checksIncluded).toContain('soldBy');
    expect(IMEI_SERVICE_TIERS.macInfo.checksIncluded).toContain('wifiMac');
    expect(IMEI_SERVICE_TIERS.macPhotoReport.checksIncluded).toContain(
      'devicePhoto'
    );
  });
});
