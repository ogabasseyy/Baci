import { describe, expect, it, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({
  categories: vi.fn(),
  brands: vi.fn(),
  attributeSet: vi.fn(),
}));
vi.mock('@/lib/jumia/catalog', () => ({
  getAllCategories: (...args: unknown[]) => catalogMocks.categories(...args),
  getAllBrands: (...args: unknown[]) => catalogMocks.brands(...args),
  getAttributeSet: (...args: unknown[]) => catalogMocks.attributeSet(...args),
}));

import {
  loadProductPreflightMetadata,
  loadProductPreflightPage,
} from './load-product-preflight';

const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

describe('loadProductPreflightPage', () => {
  it('accepts requested products only from the exact authorized RPC page and versions', async () => {
    const productId = uuid('a');
    const page = {
      selectionId: uuid('b'),
      sourceCategoryId: uuid('c'),
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
      products: [
        {
          id: productId,
          ordinal: 1,
          capturedSourceVersion: 'a'.repeat(64),
          currentSourceVersion: 'a'.repeat(64),
          available: true,
          unavailableReason: null,
          product: { contractVersion: 1 },
        },
      ],
    };
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    await expect(
      loadProductPreflightPage({ rpc } as never, {
        merchantId: uuid('d'),
        selectionId: page.selectionId,
        sourceCategoryId: page.sourceCategoryId,
        sourcePage: { page: 1, limit: 100 },
        products: [{ productId, sourceVersion: 'a'.repeat(64) }],
      })
    ).resolves.toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'get_jumia_product_export_selection_page_for_merchant',
      expect.objectContaining({ p_page: 1, p_limit: 100 })
    );
  });

  it('rejects an RPC page whose returned product count exceeds the requested bound', async () => {
    const productId = uuid('a');
    const page = {
      selectionId: uuid('b'),
      sourceCategoryId: uuid('c'),
      total: 1,
      page: 1,
      limit: 1,
      totalPages: 1,
      products: [
        {
          id: productId,
          ordinal: 1,
          capturedSourceVersion: 'a'.repeat(64),
          currentSourceVersion: 'a'.repeat(64),
          available: true,
          unavailableReason: null,
          product: { contractVersion: 1 },
        },
        {
          id: uuid('f'),
          ordinal: 2,
          capturedSourceVersion: 'f'.repeat(64),
          currentSourceVersion: 'f'.repeat(64),
          available: true,
          unavailableReason: null,
          product: { contractVersion: 1 },
        },
      ],
    };
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });

    await expect(
      loadProductPreflightPage({ rpc } as never, {
        merchantId: uuid('d'),
        selectionId: page.selectionId,
        sourceCategoryId: page.sourceCategoryId,
        sourcePage: { page: 1, limit: 1 },
        products: [{ productId, sourceVersion: 'a'.repeat(64) }],
      })
    ).resolves.toEqual({
      success: false,
      code: 'selection_mismatch',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('loadProductPreflightMetadata', () => {
  const client = { integrationId: 'exact-integration' } as never;
  const category = {
    code: 123,
    name: 'Gaming',
    completePath: 'Gaming',
    hasChildren: false,
    attributeSet: { sid: uuid('e'), name: 'Gaming' },
  };
  const brand = { code: 456, name: 'Nintendo' };
  const mapping = {
    productId: uuid('a'),
    category: { code: category.code, name: category.name },
    brand,
    attributeSetId: category.attributeSet.sid,
  };

  it('loads current metadata once through the exact selected integration and resolves a complete mapping', async () => {
    catalogMocks.categories.mockResolvedValueOnce([category]);
    catalogMocks.brands.mockResolvedValueOnce([brand]);
    catalogMocks.attributeSet.mockResolvedValueOnce({ attributes: [] });
    await expect(
      loadProductPreflightMetadata(client, [mapping])
    ).resolves.toEqual({
      success: true,
      mappings: [
        {
          productId: mapping.productId,
          category,
          brand,
          attributes: [],
        },
      ],
    });
    expect(catalogMocks.categories).toHaveBeenCalledWith(client);
    expect(catalogMocks.brands).toHaveBeenCalledWith(client);
    expect(catalogMocks.attributeSet).toHaveBeenCalledWith(
      client,
      mapping.attributeSetId
    );
  });

  it('does not treat provider-wide metadata as a missing destination capability', async () => {
    catalogMocks.categories.mockResolvedValueOnce([category]);
    catalogMocks.brands.mockResolvedValueOnce([brand]);
    catalogMocks.attributeSet.mockResolvedValueOnce({ attributes: [] });
    const result = await loadProductPreflightMetadata(client, [mapping]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mappings[0].category.hasChildren).toBe(false);
      expect(result.mappings[0].brand).toEqual(brand);
      expect(result.mappings[0]).not.toHaveProperty('availableForDestination');
    }
  });

  it('fails closed on unknown mapping metadata and provider failures', async () => {
    catalogMocks.categories.mockResolvedValueOnce([category]);
    catalogMocks.brands.mockResolvedValueOnce([]);
    catalogMocks.attributeSet.mockResolvedValueOnce({ attributes: [] });
    await expect(
      loadProductPreflightMetadata(client, [mapping])
    ).resolves.toEqual({
      success: false,
      code: 'mapping_metadata_missing',
    });

    catalogMocks.categories.mockRejectedValueOnce(new Error('private detail'));
    await expect(
      loadProductPreflightMetadata(client, [mapping])
    ).resolves.toEqual({ success: false, code: 'metadata_unavailable' });
  });
});
