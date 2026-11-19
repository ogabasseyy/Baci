import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callStorefrontPreflightRpc,
  resetStorefrontPreflightRpcForTests,
} from './storefront-preflight-rpc';
import { context } from './storefront-preflight-rpc.test-utils';
import {
  getStorefrontPreflightMemoWriteDecision,
  PDP_PUBLISHED_ACTIVE_TTL_MS,
} from './storefront-preflight-rpc-memo-policy';

const VALID_PDP_ROW = {
  storefront_status: 'published',
  catalog_nonempty: true,
  present: true,
  match_kind: 'active',
  product_id: null,
  product_name: null,
  product_slug: null,
  product_category: null,
  category_id: null,
  category_name: null,
  category_slug: null,
};

describe('getStorefrontPreflightMemoWriteDecision', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    vi.unstubAllEnvs();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('gives published active PDP rows 60s, non-active/negative rows default TTL, and rejects invalid rows', () => {
    expect(
      getStorefrontPreflightMemoWriteDecision(
        'get_storefront_pdp_preflight',
        VALID_PDP_ROW
      )
    ).toEqual({ shouldMemoize: true, ttlMs: PDP_PUBLISHED_ACTIVE_TTL_MS });

    expect(
      getStorefrontPreflightMemoWriteDecision('get_storefront_pdp_preflight', {
        ...VALID_PDP_ROW,
        present: false,
        match_kind: 'none',
      })
    ).toEqual({ shouldMemoize: true });

    expect(
      getStorefrontPreflightMemoWriteDecision('get_storefront_pdp_preflight', {
        ...VALID_PDP_ROW,
        match_kind: 'alias',
      })
    ).toEqual({ shouldMemoize: true });

    expect(
      getStorefrontPreflightMemoWriteDecision('get_storefront_pdp_preflight', {
        invalid: true,
      })
    ).toEqual({ shouldMemoize: false });

    expect(
      getStorefrontPreflightMemoWriteDecision(
        'get_storefront_blog_post_status',
        {
          any: 'row',
        }
      )
    ).toEqual({ shouldMemoize: true });
  });

  it('caches get_storefront_pdp_preflight active published verdicts for 60s and non-active verdicts for 3s', async () => {
    vi.useFakeTimers();
    const posRpc = vi.fn().mockResolvedValue({
      data: [VALID_PDP_ROW],
      error: null,
    });
    const negRpc = vi.fn().mockResolvedValue({
      data: [{ ...VALID_PDP_ROW, present: false, match_kind: 'none' }],
      error: null,
    });

    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'live-phone' },
      { failOpenContext: context(), rpcImpl: posRpc }
    );
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'dead-phone' },
      { failOpenContext: context(), rpcImpl: negRpc }
    );
    expect(posRpc).toHaveBeenCalledTimes(1);
    expect(negRpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'live-phone' },
      { failOpenContext: context(), rpcImpl: posRpc }
    );
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'dead-phone' },
      { failOpenContext: context(), rpcImpl: negRpc }
    );
    expect(posRpc).toHaveBeenCalledTimes(1);
    expect(negRpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000); // 4s total -> negative expired (3s), active still cached (60s)
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'live-phone' },
      { failOpenContext: context(), rpcImpl: posRpc }
    );
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'dead-phone' },
      { failOpenContext: context(), rpcImpl: negRpc }
    );
    expect(posRpc).toHaveBeenCalledTimes(1);
    expect(negRpc).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(57_000); // 61s total -> active expired
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'live-phone' },
      { failOpenContext: context(), rpcImpl: posRpc }
    );
    expect(posRpc).toHaveBeenCalledTimes(2);
  });

  it('does not memoize schema-invalid get_storefront_pdp_preflight rows', async () => {
    const rpcImpl = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ invalid: true }], error: null })
      .mockResolvedValueOnce({ data: [VALID_PDP_ROW], error: null });

    const first = await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'phone' },
      { failOpenContext: context(), rpcImpl }
    );
    const second = await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'phone' },
      { failOpenContext: context(), rpcImpl }
    );

    expect(first?.data).toEqual({ invalid: true });
    expect(second?.data).toEqual(VALID_PDP_ROW);
    expect(second?.attempt).not.toBeNull();
    expect(rpcImpl).toHaveBeenCalledTimes(2);
  });
});
