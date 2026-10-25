import { describe, expect, it, vi } from 'vitest';
import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';
import { enrichImeiDeviceResult } from '@/lib/imei-device-catalog';
import {
  cacheLookupResponse,
  cacheSuccessfulLookup,
} from './route-cache-helpers';

type CacheUpdateResponse = {
  data: { id: string } | null;
  error: { message: string } | null;
};

describe('cacheLookupResponse', () => {
  function mockCacheUpdate(
    response: CacheUpdateResponse = {
      data: { id: 'lookup-1' },
      error: null,
    }
  ) {
    const single = vi.fn().mockResolvedValue(response);
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    return { eq, from, select, single, update };
  }

  it('persists normalized identity and the colour image in the same completed lookup', async () => {
    const { from, update } = mockCacheUpdate();
    const data: ImeiCheckResult = {
      imei: '490154203237518',
      device: 'iPhone 17 Pro Max',
      modelNumber: '',
      status: 'Unknown',
      icloud: 'Unknown',
      icloudLock: 'ON',
      simLock: 'Unknown',
      blacklistStatus: 'Unknown',
      carrier: 'Unknown',
      deviceImage: 'https://cdn.example.com/silver.jpg',
      score: 70,
      deviceType: 'apple',
      verdict: 'Find My is on',
      verdictType: 'caution',
      deviceProfile: {
        version: 1,
        brand: 'Apple',
        model: 'iPhone 17 Pro Max',
        color: 'Silver',
        storage: '512GB',
        imageMatch: 'color',
      },
    };
    vi.mocked(enrichImeiDeviceResult).mockResolvedValueOnce(data);
    await cacheSuccessfulLookup({
      amount: 300,
      customerId: 'customer-1',
      merchantId: 'merchant-1',
      lookupId: 'lookup-1',
      latencyMs: 10,
      tier: 'basic',
      supabaseAdmin: { from } as never,
      providerResult: {
        ok: true,
        status: 200,
        sickwStatus: 'success',
        rawResponseText: '{}',
        body: {
          success: true,
          data: { ...data, deviceProfile: undefined, deviceImage: '' },
          tier: { name: 'Quick ID', checksIncluded: ['device'] },
        },
      },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        cached_response: expect.objectContaining({
          data: expect.objectContaining({
            deviceProfile: data.deviceProfile,
            deviceImage: data.deviceImage,
          }),
        }),
      })
    );
  });

  it('caches a lookup response when exactly one row is updated', async () => {
    const { eq, from, select, single, update } = mockCacheUpdate();
    const body = {
      code: 'CACHE_TEST',
      error: 'Cache test failed',
      success: false as const,
    };

    await cacheLookupResponse({
      body,
      lookupId: 'lookup-1',
      status: 200,
      supabaseAdmin: { from } as never,
      terminalStatus: 'completed',
    });

    expect(from).toHaveBeenCalledWith('imei_lookups');
    expect(update).toHaveBeenCalledWith({
      cached_response: body,
      cached_status: 200,
      status: 'completed',
    });
    expect(eq).toHaveBeenCalledWith('id', 'lookup-1');
    expect(select).toHaveBeenCalledWith('id');
    expect(single).toHaveBeenCalled();
  });

  it('caches response hash and provider status when supplied', async () => {
    const { update } = mockCacheUpdate();

    await cacheLookupResponse({
      body: {
        code: 'SICKW_UNAVAILABLE',
        error: 'Provider failed',
        success: false,
      },
      lookupId: 'lookup-1',
      responseHash: 'response-hash',
      sickwStatus: 'error',
      status: 502,
      supabaseAdmin: { from: vi.fn(() => ({ update })) } as never,
      terminalStatus: 'refunded_not_found',
    });

    expect(update).toHaveBeenCalledWith({
      cached_response: {
        code: 'SICKW_UNAVAILABLE',
        error: 'Provider failed',
        success: false,
      },
      cached_status: 502,
      response_hash: 'response-hash',
      sickw_status: 'error',
      status: 'refunded_not_found',
    });
  });

  it('throws when the Supabase update returns an error', async () => {
    const { from } = mockCacheUpdate({
      data: null,
      error: { message: 'permission denied' },
    });

    await expect(
      cacheLookupResponse({
        body: {
          code: 'CACHE_TEST',
          error: 'Cache test failed',
          success: false,
        },
        lookupId: 'lookup-1',
        status: 200,
        supabaseAdmin: { from } as never,
        terminalStatus: 'completed',
      })
    ).rejects.toThrow('permission denied');
  });

  it('requires the imei_lookups update to affect exactly one row', async () => {
    const { eq, from, select, single, update } = mockCacheUpdate({
      data: null,
      error: {
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });

    await expect(
      cacheLookupResponse({
        body: {
          code: 'CACHE_TEST',
          error: 'Cache test failed',
          success: false,
        },
        lookupId: 'missing-lookup',
        status: 200,
        supabaseAdmin: { from } as never,
        terminalStatus: 'completed',
      })
    ).rejects.toThrow('Failed to cache IMEI lookup response');

    expect(from).toHaveBeenCalledWith('imei_lookups');
    expect(update).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('id', 'missing-lookup');
    expect(select).toHaveBeenCalledWith('id');
    expect(single).toHaveBeenCalled();
  });
});

vi.mock('@/lib/imei-device-catalog', () => ({
  enrichImeiDeviceResult: vi.fn(
    async (_merchantId: string, result: unknown) => result
  ),
}));
