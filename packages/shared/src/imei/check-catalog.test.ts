import { describe, expect, it } from 'vitest';
import { groupImeiCheckCatalog, IMEI_CHECK_CATALOG } from './check-catalog';
import { IMEI_SERVICE_TIERS, PUBLIC_IMEI_SERVICE_TIERS } from './service-tiers';

describe('customer check outcome catalog', () => {
  it('groups all 78 entries exactly once without exposing supplier products', () => {
    const entries = groupImeiCheckCatalog().flatMap((group) => group.entries);
    expect(entries).toHaveLength(78);
    expect(new Set(entries.map((x) => x.id)).size).toBe(78);
    expect(
      entries.some(
        (x) => 'productId' in x || 'costUsd' in x || 'providerServiceId' in x
      )
    ).toBe(false);
  });
  it('filters by brand and hardware without offering Apple locks to other brands', () => {
    const samsung = groupImeiCheckCatalog({
      brand: 'samsung',
      device: 'smartphone',
    }).flatMap((x) => x.entries);
    expect(samsung.some((x) => x.id === 'samsungDetails')).toBe(true);
    expect(samsung.some((x) => x.id === 'findMy')).toBe(false);
    expect(samsung.some((x) => x.id === 'blacklist')).toBe(true);
    const hp = groupImeiCheckCatalog({ brand: 'hp', device: 'laptop' }).flatMap(
      (x) => x.entries
    );
    expect(hp.map((x) => x.id)).toEqual(['hpPcIdentity']);
  });
  it('creates distinct unpriced catalog entries without adding purchasing tiers', () => {
    const newEntries = Object.entries(IMEI_CHECK_CATALOG).filter(
      ([, entry]) => !entry.relatedTierKeys.length
    );
    expect(newEntries).toHaveLength(42);
    for (const [id] of newEntries)
      expect(
        (PUBLIC_IMEI_SERVICE_TIERS as readonly string[]).includes(id)
      ).toBe(false);
    expect(IMEI_SERVICE_TIERS.basic.price).toBe(300);
    expect(IMEI_SERVICE_TIERS.full.price).toBe(1500);
  });
  it('uses outcome names and questions rather than unexplained supplier source or premium labels', () => {
    for (const entry of Object.values(IMEI_CHECK_CATALOG)) {
      expect(entry.name).not.toMatch(/\b(?:pro|premium|source|gsx)\b/i);
      expect(entry.question.length).toBeGreaterThan(15);
    }
  });
});

it('offers iMac lock outcomes and limits Dell identity to laptops', () => {
  const ids = groupImeiCheckCatalog({
    brand: 'apple',
    device: 'desktop',
  }).flatMap((group) => group.entries.map((entry) => entry.id));
  expect(ids).toContain('macFindMy');
  expect(ids).toContain('macOwnershipStatus');
  expect(groupImeiCheckCatalog({ brand: 'dell', device: 'desktop' })).toEqual(
    []
  );
});

it('excludes phone-only outcomes from laptop and watch selections', () => {
  for (const device of ['laptop', 'watch'] as const) {
    const ids = groupImeiCheckCatalog({ brand: 'apple', device }).flatMap(
      (group) => group.entries.map((entry) => entry.id)
    );
    expect(ids).not.toContain('appleModel');
    expect(ids).not.toContain('applePurchaseDate');
  }
});

it('treats all brands as unfiltered while preserving the device selection', () => {
  expect(groupImeiCheckCatalog({ brand: 'all' })).toEqual(
    groupImeiCheckCatalog()
  );
  const smartphone = groupImeiCheckCatalog({
    brand: 'all',
    device: 'smartphone',
  });
  expect(smartphone).toEqual(groupImeiCheckCatalog({ device: 'smartphone' }));
  const ids = smartphone.flatMap((group) =>
    group.entries.map((entry) => entry.id)
  );
  expect(ids).toContain('findMy');
  expect(ids).toContain('samsungDetails');
  expect(ids).toContain('blacklist');
  expect(ids).not.toContain('hpPcIdentity');
});
