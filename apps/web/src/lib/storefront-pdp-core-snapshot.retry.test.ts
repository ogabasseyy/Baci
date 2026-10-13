import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontDatabase } from '@/types/storefront-database';
import { readStorefrontPdpCoreSnapshot } from './storefront-pdp-core-snapshot';

function createClientWithResponses(responses: unknown[]) {
  const retry = vi.fn();
  for (const response of responses) {
    retry.mockResolvedValueOnce(response);
  }
  const abortSignal = vi.fn(() => ({ retry }));
  const rpc = vi.fn(() => ({ abortSignal, retry }));
  return {
    abortSignal,
    client: { rpc } as unknown as SupabaseClient<StorefrontDatabase>,
    rpc,
    retry,
  };
}

describe('readStorefrontPdpCoreSnapshot transient retry boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('retries one transient RPC failure and returns the recovered product', async () => {
    const row = {
      resolution_status: 'found',
      product_data: {
        id: 'product-1',
        slug: 'phone-one',
        product_variants: [],
      },
    };
    const { abortSignal, client, rpc, retry } = createClientWithResponses([
      {
        data: null,
        error: { code: 'PGRST003', message: 'pool timeout' },
        status: 504,
      },
      { data: [row], error: null, status: 200 },
    ]);

    await expect(
      readStorefrontPdpCoreSnapshot(client, {
        merchantId: 'merchant-1',
        productSlug: 'phone-one',
      })
    ).resolves.toEqual({
      status: 'found',
      value: { kind: 'product', product: row.product_data },
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenNthCalledWith(1, false);
    expect(retry).toHaveBeenNthCalledWith(2, false);
    expect(abortSignal).toHaveBeenCalledTimes(2);
    const abortCalls = abortSignal.mock.calls as unknown as [AbortSignal][];
    expect(abortCalls[0]?.[0]).toBe(abortCalls[1]?.[0]);
  });

  it('does not retry a genuine database failure', async () => {
    const { client, rpc, retry } = createClientWithResponses([
      {
        data: null,
        error: {
          code: '22P02',
          message: 'invalid input syntax for type uuid',
        },
        status: 400,
      },
      {
        data: [
          {
            resolution_status: 'found',
            product_data: {
              id: 'product-1',
              slug: 'phone-one',
              product_variants: [],
            },
          },
        ],
        error: null,
        status: 200,
      },
    ]);

    await expect(
      readStorefrontPdpCoreSnapshot(client, {
        merchantId: 'merchant-1',
        productSlug: 'phone-one',
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        code: '22P02',
        kind: 'database',
        retryable: false,
      }),
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps a persistent transient failure unavailable after one retry', async () => {
    const transientFailure = {
      data: null,
      error: { code: 'PGRST003', message: 'pool timeout' },
      status: 504,
    };
    const { client, rpc, retry } = createClientWithResponses([
      transientFailure,
      transientFailure,
    ]);

    await expect(
      readStorefrontPdpCoreSnapshot(client, {
        merchantId: 'merchant-1',
        productSlug: 'phone-one',
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind: 'timeout',
        operation: 'pdp_core_snapshot',
        retryable: true,
      }),
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('converts a native runtime timeout into a typed unavailable result', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
      AbortSignal.abort(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError'
        )
      )
    );
    const retry = vi
      .fn()
      .mockRejectedValue(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError'
        )
      );
    const abortSignal = vi.fn(() => ({ retry }));
    const rpc = vi.fn(() => ({ abortSignal, retry }));
    const client = { rpc } as unknown as SupabaseClient<StorefrontDatabase>;

    await expect(
      readStorefrontPdpCoreSnapshot(client, {
        merchantId: 'merchant-1',
        productSlug: 'phone-one',
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind: 'timeout',
        operation: 'pdp_core_snapshot',
        retryable: true,
      }),
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(abortSignal).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
