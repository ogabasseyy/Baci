import { describe, expect, it, vi } from 'vitest';
import { loadBrilStashSources } from './load-catalogue';
import { stageBrilStashSnapshot } from './stage-catalogue';

vi.mock('./load-catalogue', () => ({ loadBrilStashSources: vi.fn() }));
const context = {
  installationId: '30000000-0000-4000-8000-000000000001',
  merchantId: '20000000-0000-4000-8000-000000000001',
  storefrontOrigin: 'https://shop.example.invalid',
};
const candidateId = '70000000-0000-4000-8000-000000000001';
const loaded = {
  installationId: context.installationId,
  merchantId: context.merchantId,
  storefrontOrigin: context.storefrontOrigin,
  catalogueRevision: '42',
  sourceReadAt: '2026-11-19T01:00:00+00:00',
  sourceRows: [],
  expectedActiveGenerationId: null,
  sources: [
    {
      id: 'source-one',
      kind: 'product' as const,
      visible: true,
      installationId: context.installationId,
      merchantId: context.merchantId,
      condition: 'new',
      name: 'Test phone',
      brand: 'Fixture',
      productUrl: `${context.storefrontOrigin}/products/phone`,
      categoryId: 'phones',
      currency: 'NGN',
      priceNaira: 365000,
      approvedFacts: {
        specifications: '128GB',
        boxContents: 'Phone',
        warranty: '30 days',
      },
      inventory: { kind: 'quantity' as const, units: 0 },
      verifiedImages: ['https://images.example.invalid/phone.jpg'],
    },
  ],
  identities: new Map([['product:source-one', 'listing-one']]),
  categoryMap: new Map([['phones', 'Phones']]),
  factsRevisionsByExternalId: { 'listing-one': '1' },
  previousExternalIds: [],
  retiredExternalIds: [],
  approvedExternalIds: ['listing-one'],
};

describe('stageBrilStashSnapshot', () => {
  it('sends the exact complete payload, source evidence and original revision to staging', async () => {
    vi.mocked(loadBrilStashSources).mockResolvedValueOnce(loaded);
    const rpc = vi.fn(async () => ({ data: candidateId, error: null }));
    await expect(
      stageBrilStashSnapshot({ rpc }, context, candidateId)
    ).resolves.toEqual({ candidateId });
    expect(rpc).toHaveBeenCalledWith(
      'stage_brilstash_catalogue_snapshot',
      expect.objectContaining({
        p_installation_id: context.installationId,
        p_candidate_id: candidateId,
        p_catalogue_revision: '42',
        p_source_read_at: loaded.sourceReadAt,
        p_source_rows: loaded.sourceRows,
        p_payload: [
          expect.objectContaining({
            external_id: 'listing-one',
            price_naira: 365000,
            stock_quantity: 0,
          }),
        ],
        p_payload_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
  });

  it('refuses to stage a partial assortment', async () => {
    vi.mocked(loadBrilStashSources).mockResolvedValueOnce({
      ...loaded,
      approvedExternalIds: ['listing-one', 'missing'],
    });
    const rpc = vi.fn();
    await expect(
      stageBrilStashSnapshot({ rpc }, context, candidateId)
    ).rejects.toThrow(
      'BrilStash candidate rejected: incomplete_assortment. Missing approved listings: ["missing"]'
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
