import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  resolveRepairsCatalogMerchant: vi.fn(),
  getRepairDevicesForMerchant: vi.fn(),
}));

vi.mock('@/lib/repairs/repairs-catalog-access', () => ({
  resolveRepairsCatalogMerchant: mocks.resolveRepairsCatalogMerchant,
}));

vi.mock('@/lib/repairs/repairs-catalog-data', () => ({
  getRepairDevicesForMerchant: mocks.getRepairDevicesForMerchant,
}));

function buildRequest(query = ''): NextRequest {
  return {
    nextUrl: new URL(
      `https://example.com/api/storefront/ogabassey/repairs/devices${query}`
    ),
  } as unknown as NextRequest;
}

const params = (slug: string) => Promise.resolve({ slug });

describe('GET /api/storefront/[slug]/repairs/devices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRepairsCatalogMerchant.mockResolvedValue({
      merchantId: 'merchant-1',
      enabled: true,
    });
    mocks.getRepairDevicesForMerchant.mockResolvedValue([]);
  });

  it('returns 400 for an invalid store slug', async () => {
    const response = await GET(buildRequest(), { params: params('BAD SLUG') });

    expect(response.status).toBe(400);
    expect(mocks.resolveRepairsCatalogMerchant).not.toHaveBeenCalled();
  });

  it('returns 400 for an overly long search query', async () => {
    const response = await GET(buildRequest(`?q=${'a'.repeat(101)}`), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 when the merchant does not exist', async () => {
    mocks.resolveRepairsCatalogMerchant.mockResolvedValueOnce(null);

    const response = await GET(buildRequest(), { params: params('ogabassey') });

    expect(response.status).toBe(404);
    expect(mocks.getRepairDevicesForMerchant).not.toHaveBeenCalled();
  });

  it('returns 404 when the repairs catalogue is disabled', async () => {
    mocks.resolveRepairsCatalogMerchant.mockResolvedValueOnce({
      merchantId: 'merchant-1',
      enabled: false,
    });

    const response = await GET(buildRequest(), { params: params('ogabassey') });

    expect(response.status).toBe(404);
    expect(mocks.getRepairDevicesForMerchant).not.toHaveBeenCalled();
  });

  it('returns grouped devices and forwards the search query', async () => {
    mocks.getRepairDevicesForMerchant.mockResolvedValueOnce([
      { brand: 'Apple', devices: [{ id: 'd1' }] },
    ]);

    const response = await GET(buildRequest('?q=iphone'), {
      params: params('ogabassey'),
    });
    const body = (await response.json()) as { groups: unknown[] };

    expect(response.status).toBe(200);
    expect(body.groups).toEqual([{ brand: 'Apple', devices: [{ id: 'd1' }] }]);
    expect(mocks.getRepairDevicesForMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'iphone',
      'catalog'
    );
  });

  it('forwards suggestion mode to the data layer', async () => {
    await GET(buildRequest('?q=iphone&mode=suggestions'), {
      params: params('ogabassey'),
    });

    expect(mocks.getRepairDevicesForMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'iphone',
      'suggestions'
    );
  });

  it('returns 500 when the data layer throws', async () => {
    mocks.getRepairDevicesForMerchant.mockRejectedValueOnce(new Error('boom'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await GET(buildRequest(), {
        params: params('ogabassey'),
      });

      expect(response.status).toBe(500);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
