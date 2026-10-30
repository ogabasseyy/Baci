import {
  filterRuntimeImeiTierKeys,
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
  PUBLIC_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { resolveImeiProviderBinding } from '../tier-bindings';
import type { ResolveImeiProviderBindingInput } from '../types';
import capture from './fixtures/petrock-esim-1941-20261030.json';
import { findPetrockCheckMapping } from './petrock-check-catalog';
import { parsePetrockReplay } from './petrock-parser';

const input: ResolveImeiProviderBindingInput = {
  clientSupportsAsync: true,
  deviceCategory: 'smartphone',
  petrockEnabled: true,
  petrockEnabledTiers: new Set(['esimCompatibility']),
  tier: IMEI_SERVICE_TIERS.esimCompatibility,
  tierKey: 'esimCompatibility',
};

describe('captured eSIM binding scope', () => {
  it('binds only the verified product and preserves both price baselines', () => {
    expect(resolveImeiProviderBinding(input)).toMatchObject({
      productId: capture.productId,
      costUsd: 0.04,
      orderFieldName: 'IMEI',
      deviceCategories: ['smartphone'],
      provider: 'petrock',
    });
    expect(input.tier).toMatchObject({
      price: 700,
      costUsd: 0.04,
      identifier: 'imei',
      brandScopes: ['apple'],
      deviceCategories: ['smartphone'],
    });
  });

  it('publishes the tier while runtime availability fails closed', () => {
    expect(PUBLIC_IMEI_SERVICE_TIERS).toContain('esimCompatibility');
    expect(filterRuntimeImeiTierKeys(['esimCompatibility'], null)).toEqual([]);
    expect(filterRuntimeImeiTierKeys(['esimCompatibility'], [])).toEqual([]);
    expect(
      filterRuntimeImeiTierKeys(['esimCompatibility'], ['esimCompatibility'])
    ).toEqual(['esimCompatibility']);
  });

  it.each([
    { deviceCategory: undefined },
    { deviceCategory: 'tablet' as const },
    { deviceCategory: 'laptop' as const },
    { deviceCategory: 'watch' as const },
    { petrockEnabled: false },
    { clientSupportsAsync: false },
    { petrockEnabledTiers: new Set<ImeiServiceTierKey>() },
  ])('fails closed outside the captured/configured scope: %j', (patch) => {
    expect(resolveImeiProviderBinding({ ...input, ...patch })).toBeNull();
  });

  it('ties all advertised fields to sanitized captured output', () => {
    const parsed = parsePetrockReplay(capture.replay);
    for (const field of input.tier.checksIncluded) {
      expect(parsed[field]).toBeTruthy();
      expect(parsed[field]).not.toBe('Unknown');
    }
    expect(findPetrockCheckMapping(capture.productId)).toMatchObject({
      evidence: 'successful_probe',
      observedFields: input.tier.checksIncluded,
      brandScope: ['apple'],
      deviceScope: ['smartphone'],
      identifiers: ['imei'],
    });
  });
});
