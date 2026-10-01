import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAbortSignalTimeout } from './abort-signal-timeout';
import {
  gateStorefrontPreflightStatus,
  resetStorefrontPreflightRpcForTests,
} from './storefront-preflight-rpc';
import {
  callRpc,
  context,
  expectFailOpenReason,
  expectSkipReason,
} from './storefront-preflight-rpc.test-utils';

vi.mock('./abort-signal-timeout', { spy: true });

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

describe('callStorefrontPreflightRpc', () => {
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

  it('defaults the abort budget to 2 seconds (tail-event recovery, not a stall bound)', async () => {
    const rpcImpl = vi
      .fn()
      .mockResolvedValue({ data: [{ ok: true }], error: null });

    await callRpc('budget_default_fn', { p: 'budget' }, rpcImpl);

    expect(vi.mocked(createAbortSignalTimeout)).toHaveBeenCalledWith(2_000);
  });

  it('returns the single row when the rpc call succeeds', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: [{ storefront_status: 'published' }],
      error: null,
    });

    const result = await callRpc('success_fn', { p_slug: 's' }, rpcImpl);

    expect(result).toEqual({ storefront_status: 'published' });
    expect(rpcImpl).toHaveBeenCalledTimes(1);
  });

  it('collapses identical fn+args calls into one rpc invocation regardless of surface', async () => {
    const rpcImpl = vi
      .fn()
      .mockResolvedValue({ data: [{ ok: true }], error: null });
    const args = { p_identifier: 'memo-identifier', p_slug: 'memo-slug' };

    const first = await callRpc('memo_fn', args, rpcImpl, {
      surface: 'product-slug',
    });
    const second = await callRpc('memo_fn', args, rpcImpl, {
      surface: 'product-canonical',
    });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(rpcImpl).toHaveBeenCalledTimes(1);
  });

  it('issues a separate rpc call when the args differ', async () => {
    const rpcImpl = vi
      .fn()
      .mockResolvedValue({ data: [{ ok: true }], error: null });

    await callRpc('memo_fn_diff', { p_slug: 'a' }, rpcImpl);
    await callRpc('memo_fn_diff', { p_slug: 'b' }, rpcImpl);

    expect(rpcImpl).toHaveBeenCalledTimes(2);
  });

  it('does not memoize a non-timeout failed call, so a retry can succeed', async () => {
    const rpcImpl = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'XX000', message: 'boom' },
      })
      .mockResolvedValueOnce({ data: [{ ok: true }], error: null });
    const args = { p_slug: 'retry-slug' };

    const first = await callRpc('retry_fn', args, rpcImpl);
    const second = await callRpc('retry_fn', args, rpcImpl);

    expect(first).toBeNull();
    expect(second).toEqual({ ok: true });
    expect(rpcImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['AbortError', 'timeout'],
    ['TimeoutError', 'timeout'],
  ] as const)('classifies a %s rejection as reason %s', async (domExceptionName, reason) => {
    const rpcImpl = vi
      .fn()
      .mockRejectedValue(new DOMException('x', domExceptionName));

    const result = await callRpc(`abort_fn_${domExceptionName}`, {}, rpcImpl);

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, reason);
  });

  it('classifies a plain rejection as fetch-error and forwards its detail', async () => {
    const rpcImpl = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await callRpc('fetch_error_fn', {}, rpcImpl);

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, 'fetch-error');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ detail: 'Error network down' })
    );
  });

  it('classifies a Postgres statement-timeout error code as timeout', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'timeout' },
    });

    const result = await callRpc('statement_timeout_fn', {}, rpcImpl);

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, 'timeout');
  });

  it('classifies any other Postgres error code as has-error', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'no fn' },
    });

    const result = await callRpc('other_error_fn', {}, rpcImpl);

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, 'has-error');
  });

  it('re-classifies a supabase-js-resolved fetch failure as fetch-error and forwards diagnostics', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '', message: 'fetch failed' },
    });

    const result = await callRpc('resolved_fetch_fail_fn', {}, rpcImpl);

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, 'fetch-error');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ detail: 'fetch failed' })
    );
  });

  it.each([
    ['a non-array, non-object payload', 'nonsense'],
    ['an empty rows array', [] as unknown[]],
  ])('classifies %s as a parse failure', async (_label, data) => {
    const rpcImpl = vi.fn().mockResolvedValue({ data, error: null });

    const result = await callRpc(
      `parse_fn_${JSON.stringify(data)}`,
      {},
      rpcImpl
    );

    expect(result).toBeNull();
    expectFailOpenReason(consoleWarnSpy, 'parse');
  });

  it('treats an allowed empty rows array as an unknown storefront without a parse incident', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({ data: [], error: null });

    const result = await callRpc(
      'empty_unknown_fn',
      { p_identifier: 'unknown.example' },
      rpcImpl,
      {},
      { emptyResult: 'unknown' }
    );

    expect(result).toBeNull();
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse' })
    );
  });

  it('fails open without invoking rpcImpl when VERCEL_ENV is a non-production preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const rpcImpl = vi.fn();

    const result = await callRpc('preview_fn', {}, rpcImpl);

    expect(result).toBeNull();
    expect(rpcImpl).not.toHaveBeenCalled();
    expectFailOpenReason(consoleWarnSpy, 'no-base-url');
  });

  it('proceeds to invoke rpcImpl when VERCEL_ENV is production', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const rpcImpl = vi
      .fn()
      .mockResolvedValue({ data: [{ ok: true }], error: null });

    const result = await callRpc('prod_fn', { p_slug: 'prod-slug' }, rpcImpl);

    expect(result).toEqual({ ok: true });
    expect(rpcImpl).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after 5 consecutive failures, captures the transition once, then skips the 6th call without invoking rpcImpl', async () => {
    const rpcImpl = vi.fn().mockRejectedValue(new Error('boom'));

    for (let i = 0; i < 5; i += 1) {
      const result = await callRpc('breaker_fn', { p: 'a' }, rpcImpl);
      expect(result).toBeNull();
    }

    expect(rpcImpl).toHaveBeenCalledTimes(5);
    const failOpenCalls = consoleWarnSpy.mock.calls.filter(
      ([message]: unknown[]) =>
        message === '[storefront-internal-preflight] fail-open'
    );
    // 5 per-failure warns + exactly 1 one-time "circuit-open" transition capture.
    expect(failOpenCalls).toHaveLength(6);
    expect(failOpenCalls[5][1]).toMatchObject({ reason: 'circuit-open' });

    const sixthResult = await callRpc('breaker_fn', { p: 'a' }, rpcImpl);

    expect(sixthResult).toBeNull();
    expect(rpcImpl).toHaveBeenCalledTimes(5);
    expectSkipReason(consoleWarnSpy, 'circuit-open');
  });
});

describe('gateStorefrontPreflightStatus', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true and logs nothing for a published storefront', () => {
    const result = gateStorefrontPreflightStatus('published', context());

    expect(result).toBe(true);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it.each([
    'unknown',
    'unpublished',
  ])('returns false and logs a skip for %s status', (status) => {
    const result = gateStorefrontPreflightStatus(status, context());

    expect(result).toBe(false);
    expectSkipReason(consoleWarnSpy, 'unknown-storefront');
  });

  it('returns false and captures a fail-open for any other status value', () => {
    const result = gateStorefrontPreflightStatus(
      'weird-future-value',
      context()
    );

    expect(result).toBe(false);
    expectFailOpenReason(consoleWarnSpy, 'has-error');
  });
});
