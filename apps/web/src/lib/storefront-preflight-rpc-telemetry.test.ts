import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callStorefrontPreflightRpc,
  resetStorefrontPreflightRpcForTests,
} from './storefront-preflight-rpc';
import {
  callRpc,
  context,
  expectFailOpenReason,
} from './storefront-preflight-rpc.test-utils';

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

describe('storefront preflight RPC telemetry', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    vi.unstubAllEnvs();
    consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logs one bounded attempt record for a successful RPC, not for memo hits', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const rpcImpl = vi
      .fn()
      .mockResolvedValue({ data: [{ ok: true }], error: null });
    const options = {
      failOpenContext: context({ surface: 'product-canonical' }),
      rpcImpl,
      timeoutMs: 4_000,
    };

    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'phone' },
      options
    );
    await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'phone' },
      options
    );

    expect(rpcImpl).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[storefront-preflight-rpc] attempt',
      expect.objectContaining({
        attempt_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        deadline_ms: 4_000,
        elapsed_ms: expect.any(Number),
        outcome: 'success',
        rpc_name: 'get_storefront_pdp_preflight',
        surface: 'product-canonical',
      })
    );
    const [, attemptProperties] = consoleInfoSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(attemptProperties).not.toHaveProperty('identifier');
    expect(attemptProperties).not.toHaveProperty('slug');
  });

  it('includes attempt timing and RPC context on timeout fail-open diagnostics', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const rpcImpl = vi
      .fn()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    const result = await callStorefrontPreflightRpc(
      'get_storefront_pdp_preflight',
      { p_identifier: 'ogabassey.com', p_product_slug: 'phone' },
      {
        failOpenContext: context({ surface: 'product-canonical' }),
        rpcImpl,
        timeoutMs: 4_000,
      }
    );

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({
        attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        deadlineMs: 4_000,
        elapsedMs: expect.any(Number),
        outcome: 'client-timeout',
        reason: 'timeout',
        rpcName: 'get_storefront_pdp_preflight',
        surface: 'product-canonical',
      })
    );
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const warningContext = consoleWarnSpy.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    const [, attemptProperties] = consoleInfoSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(attemptProperties).toEqual(
      expect.objectContaining({
        attempt_id: warningContext.attemptId,
        deadline_ms: warningContext.deadlineMs,
        elapsed_ms: warningContext.elapsedMs,
        outcome: warningContext.outcome,
        rpc_name: warningContext.rpcName,
        surface: warningContext.surface,
      })
    );
  });

  it('classifies and records a Postgres statement-timeout separately', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'timeout' },
    });

    const result = await callRpc('statement_timeout_fn', {}, rpcImpl);

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, 'timeout');
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[storefront-preflight-rpc] attempt',
      expect.objectContaining({
        outcome: 'database-timeout',
        rpc_name: 'statement_timeout_fn',
      })
    );
  });
});
