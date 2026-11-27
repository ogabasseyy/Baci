import { describe, expect, it, vi } from 'vitest';
import { loadBrilStashSources } from './load-catalogue';

const installationId = '30000000-0000-4000-8000-000000000001';
const merchantId = '20000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001';
const origin = 'https://shop.example.invalid';
const row = {
  externalId: 'listing-approved',
  id: sourceId,
  parentProductId: sourceId,
  kind: 'product',
  visible: true,
  name: 'Phone',
  slug: 'fixture-phone',
  brand: 'Fixture',
  condition: 'new',
  parentCondition: 'new',
  currency: 'NGN',
  priceNaira: 350000,
  partnerCategory: 'Phones',
  categoryId: '50000000-0000-4000-8000-000000000001',
  factsRevision: '1',
  approvedFacts: {
    specifications: '128GB',
    boxContents: 'Phone',
    warranty: '30 days',
  },
  verifiedImages: ['https://media.example.invalid/phone.jpg'],
  inventory: { kind: 'quantity', units: 0, legacyUnits: 0 },
};
const result = {
  installationId,
  merchantId,
  catalogueRevision: '9007199254740993',
  expectedActiveGenerationId: null,
  sourceReadAt: '2026-11-19T01:00:00+00:00',
  rows: [row],
  retiredExternalIds: [],
  previousExternalIds: [],
};

describe('loadBrilStashSources', () => {
  it('projects exact source facts and preserves the database revision and zero quantity', async () => {
    const rpc = vi.fn(async () => ({ data: result, error: null }));
    const loaded = await loadBrilStashSources(
      { rpc },
      { installationId, merchantId, storefrontOrigin: `${origin}:443` }
    );
    expect(rpc).toHaveBeenCalledWith('load_brilstash_catalogue_sources', {
      p_installation_id: installationId,
    });
    expect(loaded.catalogueRevision).toBe('9007199254740993');
    expect(loaded.sources).toMatchObject([
      {
        id: sourceId,
        installationId,
        merchantId,
        priceNaira: 350000,
        inventory: { kind: 'quantity', units: 0 },
        productUrl: 'https://shop.example.invalid/products/fixture-phone',
      },
    ]);
    expect(loaded.identities.get(`product:${sourceId}`)).toBe(
      'listing-approved'
    );
    expect(loaded.factsRevisionsByExternalId['listing-approved']).toBe('1');
  });

  it.each([
    'café+phone',
    'caf%C3%A9%2Bphone',
  ])('matches storefront path serialization for %s', async (slug) => {
    const rpc = vi.fn(async () => ({
      data: { ...result, rows: [{ ...row, slug }] },
      error: null,
    }));
    const loaded = await loadBrilStashSources(
      { rpc },
      { installationId, merchantId, storefrontOrigin: origin }
    );
    expect(loaded.sources[0]?.productUrl).toBe(
      'https://shop.example.invalid/products/caf%C3%A9%2Bphone'
    );
  });

  it.each([
    '%2e%2e',
    '%20',
    'two/segments',
    '%252525252565',
  ])('keeps an unsafe slug out of the payload while preserving its approval', async (slug) => {
    const rpc = vi.fn(async () => ({
      data: { ...result, rows: [{ ...row, slug }] },
      error: null,
    }));
    const loaded = await loadBrilStashSources(
      { rpc },
      { installationId, merchantId, storefrontOrigin: origin }
    );
    expect(loaded.sources).toEqual([]);
    expect(loaded.approvedExternalIds).toEqual(['listing-approved']);
  });

  it('preserves reviewed zero-stock evidence and rejects a positive withdrawal', async () => {
    const approvalId = 'a0000000-0000-4000-8000-000000000001';
    const inventory = { kind: 'withdrawn', units: 0, approvalId };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ...result, rows: [{ ...row, inventory }] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...result,
          rows: [{ ...row, inventory: { ...inventory, units: 2 } }],
        },
        error: null,
      });
    const context = { installationId, merchantId, storefrontOrigin: origin };
    expect(
      (await loadBrilStashSources({ rpc }, context)).sources[0]?.inventory
    ).toEqual(inventory);
    await expect(loadBrilStashSources({ rpc }, context)).rejects.toThrow(
      'Invalid BrilStash source response'
    );
  });

  it('accepts the approved on-demand capacity and rejects a different count', async () => {
    const inventory = { kind: 'on-demand', units: 100 };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ...result, rows: [{ ...row, inventory }] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...result,
          rows: [{ ...row, inventory: { ...inventory, units: 10000 } }],
        },
        error: null,
      });
    const context = { installationId, merchantId, storefrontOrigin: origin };
    expect(
      (await loadBrilStashSources({ rpc }, context)).sources[0]?.inventory
    ).toEqual(inventory);
    await expect(loadBrilStashSources({ rpc }, context)).rejects.toThrow(
      'Invalid BrilStash source response'
    );
  });

  it('keeps ineligible approvals in the expected assortment', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ...result,
        rows: [
          { ...row, visible: false, name: null, slug: null, priceNaira: null },
        ],
      },
      error: null,
    }));
    const loaded = await loadBrilStashSources(
      { rpc },
      { installationId, merchantId, storefrontOrigin: origin }
    );
    expect(loaded.sources).toEqual([]);
    expect(loaded.approvedExternalIds).toEqual(['listing-approved']);
  });

  it('rejects scope mismatch or a database error instead of returning an empty catalogue', async () => {
    const context = { installationId, merchantId, storefrontOrigin: origin };
    await expect(
      loadBrilStashSources(
        {
          rpc: async () => ({
            data: { ...result, merchantId: installationId },
            error: null,
          }),
        },
        context
      )
    ).rejects.toThrow('Invalid BrilStash source response');
    await expect(
      loadBrilStashSources(
        {
          rpc: async () => ({ data: null, error: { message: 'private' } }),
        },
        context
      )
    ).rejects.toThrow('Unable to load BrilStash source data');
  });
});
