import { describe, expect, it, vi } from 'vitest';
import {
  loadExistingJumiaShopIds,
  loadExistingJumiaShopIdsOrResponse,
} from './load-existing-jumia-shop-ids';

describe('loadExistingJumiaShopIds', () => {
  it('returns scoped active Jumia shop identities', async () => {
    const query = {
      eq: vi.fn(),
    } as { eq: ReturnType<typeof vi.fn> };
    query.eq.mockImplementation(() =>
      query.eq.mock.calls.length >= 3
        ? Promise.resolve({
            data: [
              {
                shop_id: 'shop-1',
                country_code: 'NG',
                marketplace_key: 'NG-main',
                connection_method: 'self_authorization',
              },
            ],
            error: null,
          })
        : query
    );
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    } as never;

    await expect(
      loadExistingJumiaShopIds(supabase, 'merchant-1')
    ).resolves.toEqual(new Set(['shop-1:NG-main']));
  });

  it('throws when the integration query fails', async () => {
    const query = {
      eq: vi.fn(),
    } as { eq: ReturnType<typeof vi.fn> };
    query.eq.mockImplementation(() =>
      query.eq.mock.calls.length >= 3
        ? Promise.resolve({ data: null, error: new Error('unavailable') })
        : query
    );
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    } as never;

    await expect(
      loadExistingJumiaShopIds(supabase, 'merchant-1')
    ).rejects.toThrow('Failed to load existing Jumia shops');
  });

  it('returns a retryable response when the integration query fails', async () => {
    const query = {
      eq: vi.fn(),
    } as { eq: ReturnType<typeof vi.fn> };
    query.eq.mockImplementation(() =>
      query.eq.mock.calls.length >= 3
        ? Promise.resolve({ data: null, error: new Error('unavailable') })
        : query
    );
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    } as never;

    const response = await loadExistingJumiaShopIdsOrResponse(
      supabase,
      'merchant-1'
    );

    expect(response).toBeInstanceOf(Response);
    expect(response).toMatchObject({ status: 503 });
  });
});
