import { IMEI_SERVICE_TIERS, type ImeiServiceTierKey } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { resolveImeiProviderBinding } from '../tier-bindings';
import { validatePetrockProductSnapshot } from './petrock-preflight';

// Read-only GET /products, 2026-10-25. No customer identifiers or paid results.
const catalog = [
  { tier: 'knoxGuard', id: '699', price: 0.09, field: 'IMEI/Serial No' },
  { tier: 'pixel', id: '721', price: 0.09, field: 'IMEI' },
  { tier: 'samsung', id: '741', price: 0.08, field: 'IMEI' },
  { tier: 'simLock', id: '716', price: 0.06, field: 'IMEI' },
] as const satisfies readonly {
  tier: ImeiServiceTierKey;
  id: string;
  price: number;
  field: string;
}[];

function bindingFor(tier: ImeiServiceTierKey) {
  return resolveImeiProviderBinding({
    clientSupportsAsync: true,
    deviceCategory: 'smartphone',
    petrockEnabled: true,
    petrockEnabledTiers: new Set([tier]),
    tier: IMEI_SERVICE_TIERS[tier],
    tierKey: tier,
  });
}

describe('curated Petrock bindings against the current supplier catalog', () => {
  it.each(catalog)('matches $tier to the reviewed product, field and cost', ({
    tier,
    id,
    price,
    field,
  }) => {
    const binding = bindingFor(tier);
    expect(binding).toMatchObject({
      provider: 'petrock',
      productId: id,
      costUsd: price,
      orderFieldName: field,
    });
    if (!binding) throw new Error('Missing binding');
    const now = new Date('2026-10-25T10:00:00Z');
    expect(
      validatePetrockProductSnapshot({
        binding,
        now,
        snapshot: {
          active: true,
          currency: 'USD',
          order_field_name: field,
          price_usd: price,
          product_id: id,
          synced_at: now.toISOString(),
        },
      })
    ).toEqual({ ok: true });
  });

  it('still blocks an unreviewed price increase before billing', () => {
    const binding = bindingFor('simLock');
    if (!binding) throw new Error('Missing binding');
    const now = new Date('2026-10-25T10:00:00Z');
    expect(
      validatePetrockProductSnapshot({
        binding,
        now,
        snapshot: {
          active: true,
          currency: 'USD',
          order_field_name: 'IMEI',
          price_usd: 0.09,
          product_id: '716',
          synced_at: now.toISOString(),
        },
      })
    ).toMatchObject({ ok: false, code: 'PROVIDER_PRICE_DRIFT' });
  });
});
