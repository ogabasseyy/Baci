import { PUBLIC_IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { getDisplayTier } from './imei-checker-tiers';

describe('getDisplayTier', () => {
  it('formats the price as Nigerian naira', () => {
    const tier = getDisplayTier('full');
    expect(tier.priceDisplay).toBe('₦1,500');
  });

  it('marks the recommended tier and omits it otherwise', () => {
    expect(getDisplayTier('full').recommended).toBe(true);
    expect(getDisplayTier('activation').recommended).toBeUndefined();
  });

  it('resolves a display tier for every publicly purchasable catalog key', () => {
    for (const tierKey of PUBLIC_IMEI_SERVICE_TIERS) {
      const tier = getDisplayTier(tierKey);
      expect(tier.id).toBe(tierKey);
      expect(tier.name).toBeTruthy();
      expect(tier.icon).toBeTruthy();
      expect(tier.priceDisplay).toMatch(/^₦/);
    }
  });
});

it('explains activation checks without supplier jargon and preserves the price', () => {
  expect(getDisplayTier('activation').name).toBe('Activation check');
  expect(getDisplayTier('activation').price).toBe(700);
});
