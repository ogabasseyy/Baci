import type { NextRequest } from 'next/server';
import { expect, it, type Mock, vi } from 'vitest';

type ArchivePatch = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

type PurgeSuiteOptions = {
  PATCH: ArchivePatch;
  makeContext: (id?: string) => { params: Promise<{ id: string }> };
  makeRequest: (body?: { merchantId: string }) => NextRequest;
  merchantId: string;
  mocks: {
    archiveResult: unknown;
    merchantSlugRow: unknown;
    merchantThrows: boolean;
    revalidateProductSlugs: Mock;
    scheduleProductBlogPurgeAfterResponse: Mock;
    scheduleStorefrontProductPurge: Mock;
    selectArgs: string[];
  };
};

export function defineArchiveRoutePurgeSuite({
  PATCH,
  makeContext,
  makeRequest,
  merchantId,
  mocks,
}: PurgeSuiteOptions) {
  it('schedules a purge for the archived product with its category segment', async () => {
    const response = await PATCH(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mocks.scheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'phone-ultra', categorySegment: 'smartphones' }]
    );
  });

  it('queues linked-article enrichment after the archive response', async () => {
    await PATCH(makeRequest(), makeContext());

    expect(mocks.scheduleProductBlogPurgeAfterResponse).toHaveBeenCalledWith({
      supabase: expect.anything(),
      merchantId,
      merchantSlug: 'test-store',
      productIds: ['123e4567-e89b-42d3-a456-426614174000'],
      entries: [{ slug: 'phone-ultra', categorySegment: 'smartphones' }],
      categorySlugs: ['smartphones'],
      skipProductPurge: true,
    });
  });

  it('reads the category_id join and product_categories junction on the archive select', async () => {
    await PATCH(makeRequest(), makeContext());

    expect(
      mocks.selectArgs.some((arg) =>
        arg.includes('categories:category_id(slug, is_active)')
      )
    ).toBe(true);
    expect(
      mocks.selectArgs.some((arg) =>
        arg.includes(
          'product_categories(category_id, categories(slug, is_active))'
        )
      )
    ).toBe(true);
  });

  it('prefers the direct category_id join over the legacy text', async () => {
    mocks.archiveResult = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      slug: 'phone-ultra',
      status: 'archived',
      name: 'Phone Ultra',
      category: 'Legacy Display Name',
      categories: { slug: 'smartphones' },
      product_categories: null,
    };

    await PATCH(makeRequest(), makeContext());

    expect(mocks.scheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'phone-ultra', categorySegment: 'smartphones' }]
    );
  });

  it('busts the per-slug Next cache before scheduling the edge purge', async () => {
    await PATCH(makeRequest(), makeContext());

    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith(merchantId, [
      'phone-ultra',
    ]);
    expect(
      mocks.revalidateProductSlugs.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.scheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('falls back to the product id for the purge target when the slug is null', async () => {
    mocks.archiveResult = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      slug: null,
      status: 'archived',
      name: 'Legacy',
      category: null,
      categories: null,
      product_categories: null,
    };

    await PATCH(makeRequest(), makeContext());

    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith(merchantId, [
      '123e4567-e89b-42d3-a456-426614174000',
    ]);
    expect(mocks.scheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [
        {
          slug: '123e4567-e89b-42d3-a456-426614174000',
          categorySegment: null,
        },
      ]
    );
  });

  it('completes the archive even when scheduling the purge throws', async () => {
    mocks.scheduleStorefrontProductPurge.mockImplementationOnce(() => {
      throw new Error('purge scheduling failed');
    });

    const response = await PATCH(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('archives and still busts the Next cache when the merchant-slug read fails', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      mocks.merchantThrows = true;

      const response = await PATCH(makeRequest(), makeContext());

      expect(response.status).toBe(200);
      expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith(merchantId, [
        'phone-ultra',
      ]);
      expect(mocks.scheduleStorefrontProductPurge).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('skips the edge purge when the merchant slug is missing', async () => {
    mocks.merchantSlugRow = { slug: null };

    const response = await PATCH(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    expect(mocks.scheduleStorefrontProductPurge).toHaveBeenCalledWith(null, [
      { slug: 'phone-ultra', categorySegment: 'smartphones' },
    ]);
  });
}
