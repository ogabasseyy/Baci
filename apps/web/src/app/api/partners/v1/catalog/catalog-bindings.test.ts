import { describe, expect, it, vi } from 'vitest';
import { crossRemCatalogConfig } from './catalog-bindings';
import { sellableIdentityKey } from './sellable-identity-key';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));

describe('CrossRem catalog configuration', () => {
  it('binds the pinned Ogabassey CrossRem merchant ID', () => {
    expect(crossRemCatalogConfig.merchantId).toBe(
      '6b5cb8a4-5575-456c-b936-8cdfae30db74'
    );
  });

  it('pins the reviewed active and retired counts and rejects duplicate identities', () => {
    const { bindings } = crossRemCatalogConfig;
    const active = bindings.filter((row) => !row.retired);
    const retiredIds = bindings
      .filter((row) => row.retired)
      .map((row) => row.listingId);
    expect(retiredIds.sort()).toEqual([
      '08aba685-e428-40e1-b971-7c13b51735a5',
      '120f26d6-d54c-4a10-8ed5-9b1af2478032',
      '2eb12db1-9256-45e8-bb52-35c67200e87e',
      '30f0d807-0dde-49e5-837a-5bd9c7efbd5d',
      '41e0a7d9-3368-4cda-9d26-e3297d9ecb90',
      '5028abaa-79ba-46cf-bd66-45376f4650de',
      '52f8d91c-4c5e-4595-a5b8-024093ebaf45',
      '5bcde4ec-6929-44f7-b09e-0636def919de',
      '727ecd59-79a7-4a5c-b761-30d006c6ff6c',
      '841c0a60-2c79-424f-a70c-32f2481caa97',
      '9731dad8-ca74-4dfd-8af0-ab2c30e23cf7',
      '9b1b3858-a825-4241-89f1-87a91b6c8f59',
      'afb7842c-f744-4f8c-8be1-87d940242600',
      'b91bfaf7-dc9d-4f75-a3af-cc023e7d7a47',
      'ba75a901-b05f-4a6e-99e6-855c6fd6faca',
      'baa1a0e8-f2a1-43fc-a2a2-235811f62f7c',
      'bbd0b783-7ade-4ad5-8668-ef321d7714f2',
      'bde386de-cda5-4d8f-93de-55fe5721fd72',
      'c0579bfe-8c46-4100-88ad-970f512f1f82',
      'c3ec72c5-32aa-46bf-bdff-c9fbeace087c',
      'caf2702f-9b16-49f0-b97c-142538a37c1b',
      'cbe3c0bf-0d28-4622-b38a-04a1599a75b0',
      'd6b58ad5-860e-495e-8ba9-5ac5ca8f366a',
      'de0a6935-b470-4af7-9e00-3cb9d5aeaf11',
      'e02b10a3-f8cd-41bf-ab0d-2769cc15bb7a',
      'eb80e17d-a97c-4e54-b426-e041efcda902',
    ]);
    expect(active).toHaveLength(4475);
    expect(new Set(bindings.map((row) => row.listingId)).size).toBe(
      bindings.length
    );
    expect(new Set(bindings.map(sellableIdentityKey)).size).toBe(
      bindings.length
    );
  });

  it('uses an empty baseline if validation fails so the route can return 503', async () => {
    vi.doMock('./ogabassey-listing-bindings.json', () => ({
      default: [{ listingId: 'invalid' }],
    }));
    vi.resetModules();
    try {
      const { crossRemCatalogConfig: invalidConfig } = await import(
        './catalog-bindings'
      );
      expect(invalidConfig.bindings).toEqual([]);
      expect(warn).toHaveBeenCalledExactlyOnceWith({
        message: 'CrossRem catalog bindings failed validation',
        issueCount: 2,
        issues: [
          { code: 'invalid_type', path: '0.productId' },
          { code: 'invalid_value', path: '0.condition' },
        ],
      });
    } finally {
      vi.doUnmock('./ogabassey-listing-bindings.json');
      vi.resetModules();
    }
  });
});
