import {
  filterRuntimeImeiTierKeys,
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
  PETROCK_DARK_IMEI_SERVICE_TIERS,
  PUBLIC_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';
import { describe, expect, it, vi } from 'vitest';
import { resolveImeiProviderBinding } from '../tier-bindings';
import type { ResolveImeiProviderBindingInput } from '../types';
import capture from './fixtures/petrock-part-number-1963-20261030.json';
import { findPetrockCheckMapping } from './petrock-check-catalog';
import { createPetrockClient } from './petrock-client';
import { parsePetrockReplay } from './petrock-parser';
import { createPetrockProvider } from './petrock-provider';

const input: ResolveImeiProviderBindingInput = {
  clientSupportsAsync: true,
  deviceCategory: 'smartphone',
  petrockEnabled: true,
  petrockEnabledTiers: new Set(['applePartNumber']),
  tier: IMEI_SERVICE_TIERS.applePartNumber,
  tierKey: 'applePartNumber',
};

describe('captured Apple part-number diagnostic', () => {
  it('advertises only the captured core field with the existing retail price', () => {
    expect(input.tier).toMatchObject({
      name: 'Apple Part Number',
      features: ['Part Number'],
      checksIncluded: ['partNumber'],
      price: 700,
      costUsd: 0.12,
      brandScopes: ['apple'],
      deviceCategories: ['smartphone'],
      identifier: 'imei',
    });
    expect(resolveImeiProviderBinding(input)).toMatchObject({
      productId: '1963',
      orderFieldName: 'IMEI',
      provider: 'petrock',
      costUsd: 0.12,
    });
    expect(findPetrockCheckMapping('1963')).toMatchObject({
      evidence: 'successful_probe',
      observedFields: ['partNumber'],
      identifiers: ['imei'],
      brandScope: ['apple'],
      deviceScope: ['smartphone'],
    });
  });

  it('parses all promised fields without manufacturing missing identity or safety', () => {
    const parsed = parsePetrockReplay(capture.replay);
    expect(parsed).toMatchObject({
      partNumber: 'MFYC4J/A',
      device: '',
      modelNumber: '',
      blacklistStatus: 'Unknown',
      status: 'Unknown',
      verdictType: 'caution',
    });
    expect(JSON.stringify(capture)).not.toMatch(/\d{15}/);
    expect(capture.replay).not.toMatch(
      /IMEI|Serial Number|order_uuid|reference_id|Bearer /i
    );
  });

  it('returns the captured core diagnostic with an unknown device and fallback icon', async () => {
    const client = createPetrockClient({
      baseUrl: 'https://provider.example/api/reseller/v1',
      token: 'synthetic-test-token',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'success',
            code: 200,
            data: { status: 'success', quantity: 1, replay: capture.replay },
          })
        )
      ),
    });
    const result = await createPetrockProvider({ client }).poll({
      checksIncluded: input.tier.checksIncluded,
      identifier: 'synthetic-identifier',
      providerOrderId: 'synthetic-order',
      tierName: input.tier.name,
    });
    expect(result).toMatchObject({
      kind: 'complete',
      body: {
        data: {
          partNumber: 'MFYC4J/A',
          modelNumber: '',
          device: 'Unknown Device',
          deviceImage: '',
          blacklistStatus: 'Unknown',
          verdictType: 'caution',
        },
        tier: { checksIncluded: ['partNumber'] },
      },
    });
  });

  it('is public but hidden unless runtime capability discovery explicitly admits it', () => {
    expect(PUBLIC_IMEI_SERVICE_TIERS).toContain('applePartNumber');
    expect(PETROCK_DARK_IMEI_SERVICE_TIERS).not.toContain('applePartNumber');
    expect(filterRuntimeImeiTierKeys(['applePartNumber'], null)).toEqual([]);
    expect(filterRuntimeImeiTierKeys(['applePartNumber'], [])).toEqual([]);
    expect(
      filterRuntimeImeiTierKeys(['applePartNumber'], ['applePartNumber'])
    ).toEqual(['applePartNumber']);
  });

  it.each([
    { deviceCategory: undefined },
    { deviceCategory: 'tablet' as const },
    { deviceCategory: 'laptop' as const },
    { deviceCategory: 'watch' as const },
    { petrockEnabled: false },
    { clientSupportsAsync: false },
    { petrockEnabledTiers: new Set<ImeiServiceTierKey>() },
  ])('rejects unsupported scope/configuration: %j', (patch) => {
    expect(resolveImeiProviderBinding({ ...input, ...patch })).toBeNull();
  });
});
