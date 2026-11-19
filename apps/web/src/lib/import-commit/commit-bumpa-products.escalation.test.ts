import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProductsReliable = vi.fn();
vi.mock('@/lib/revalidate-products-reliable', () => ({
  revalidateProductsReliable: (...args: unknown[]) =>
    mockRevalidateProductsReliable(...args),
}));

import { commitBumpaProducts } from '@/lib/import-commit/commit-bumpa-products';
import type { NormalizedImportedProduct } from '@/lib/imports/bumpa/bumpa-types';

function createImportedProduct(
  overrides: Partial<NormalizedImportedProduct> = {}
): NormalizedImportedProduct {
  return {
    sourcePlatform: 'bumpa',
    externalSourceId: 'external-0',
    title: 'Imported Phone',
    description: 'Imported description',
    sku: 'SKU-0',
    price: 150000,
    currency: 'NGN',
    stock: 5,
    manageStock: true,
    status: 'active',
    images: ['https://example.com/phone-0.jpg'],
    category: 'Phones',
    sourceCreatedAt: '2026-01-01T00:00:00.000Z',
    sourceUpdatedAt: '2026-02-01T00:00:00.000Z',
    importMetadata: { source: 'bumpa' },
    ...overrides,
  };
}

function makeEscalationSupabase(existingRow: {
  id: string;
  slug: string | null;
  category: string | null;
  status: string;
  external_source: string;
  external_id: string;
}) {
  const loadQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  loadQuery.select.mockReturnValue(loadQuery);
  loadQuery.eq.mockReturnValue(loadQuery);
  loadQuery.order.mockReturnValue(loadQuery);
  loadQuery.range.mockResolvedValue({ data: [existingRow], error: null });

  const updateQuery = { update: vi.fn(), eq: vi.fn() };
  updateQuery.update.mockReturnValue(updateQuery);
  updateQuery.eq
    .mockReturnValueOnce(updateQuery)
    .mockResolvedValueOnce({ error: null });

  const merchantsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { slug: 'ogabassey' },
      error: null,
    }),
  };
  merchantsQuery.select.mockReturnValue(merchantsQuery);
  merchantsQuery.eq.mockReturnValue(merchantsQuery);

  return {
    from: vi
      .fn()
      .mockReturnValueOnce(loadQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(merchantsQuery),
  } as unknown as SupabaseClient;
}

describe('commitBumpaProducts structural escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promotes updates that change product status to purgeWholeStorefront so dependent child redirects expire', async () => {
    const supabase = makeEscalationSupabase({
      id: 'existing-product',
      slug: 'imported-phone',
      category: 'Phones',
      status: 'active',
      external_source: 'bumpa',
      external_id: 'external-0',
    });

    await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: [createImportedProduct({ status: 'draft' })],
    });

    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({ purgeWholeStorefront: true })
    );
  });

  it('promotes updates that assign a first slug to a legacy null-slug parent to purgeWholeStorefront', async () => {
    const supabase = makeEscalationSupabase({
      id: 'legacy-parent',
      slug: null,
      category: 'Phones',
      status: 'active',
      external_source: 'bumpa',
      external_id: 'external-0',
    });

    await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: [createImportedProduct()],
    });

    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({ purgeWholeStorefront: true })
    );
  });
});
