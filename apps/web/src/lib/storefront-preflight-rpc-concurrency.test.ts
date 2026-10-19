import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callStorefrontPreflightRpc,
  resetStorefrontPreflightRpcForTests,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function call(
  fn: string,
  args: Record<string, string>,
  rpcImpl: StorefrontPreflightRpcImpl,
  options: { emptyResult?: 'unknown'; timeoutMs?: number } = {}
) {
  return callStorefrontPreflightRpc(fn, args, {
    failOpenContext: {
      surface: 'product-slug',
      identifier: 'ogabassey.com',
      slug: 'apple-iphone',
    },
    rpcImpl,
    ...options,
  });
}

describe('storefront preflight RPC concurrent transport', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    vi.unstubAllEnvs();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('shares ten equal cold reads, then starts a fresh RPC after memo expiry', async () => {
    vi.useFakeTimers();
    const first = deferred<{ data: unknown; error: null }>();
    const second = deferred<{ data: unknown; error: null }>();
    const rpcImpl = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockReturnValue(first.promise);
    const args = { p_identifier: 'ogabassey.com', p_slug: 'apple-iphone' };

    const requests = Array.from({ length: 10 }, (_, index) =>
      call(
        'resolve_storefront',
        index % 2 === 0
          ? args
          : { p_slug: 'apple-iphone', p_identifier: 'ogabassey.com' },
        rpcImpl
      )
    );
    await Promise.resolve();

    expect(rpcImpl).toHaveBeenCalledTimes(1);
    first.resolve({ data: [{ kind: 'present-or-unknown' }], error: null });
    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 10 }, () => ({ kind: 'present-or-unknown' }))
    );

    await vi.advanceTimersByTimeAsync(3_001);
    rpcImpl.mockReturnValue(second.promise);
    const fresh = call('resolve_storefront', args, rpcImpl);
    await Promise.resolve();
    expect(rpcImpl).toHaveBeenCalledTimes(2);
    second.resolve({ data: [{ kind: 'fresh' }], error: null });
    await expect(fresh).resolves.toEqual({ kind: 'fresh' });
  });

  it('keeps different compatibility fields in independent flights', async () => {
    const pending = Array.from({ length: 6 }, () =>
      deferred<{ data: unknown; error: null }>()
    );
    const rpcA = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockReturnValueOnce(pending[0].promise)
      .mockReturnValueOnce(pending[1].promise)
      .mockReturnValueOnce(pending[2].promise)
      .mockReturnValueOnce(pending[3].promise)
      .mockReturnValueOnce(pending[4].promise);
    const rpcB = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockReturnValue(pending[5].promise);

    const requests = [
      call('resolve_a', { p_tenant: 'one' }, rpcA),
      call('resolve_a', { p_tenant: 'two' }, rpcA),
      call('resolve_b', { p_tenant: 'one' }, rpcA),
      call('resolve_a', { p_tenant: 'one' }, rpcB),
      call('resolve_a', { p_tenant: 'one' }, rpcA, { timeoutMs: 500 }),
      call('resolve_a', { p_tenant: 'one' }, rpcA, { emptyResult: 'unknown' }),
    ];
    await Promise.resolve();

    expect(rpcA).toHaveBeenCalledTimes(5);
    expect(rpcB).toHaveBeenCalledTimes(1);
    for (const read of pending.slice(0, 6)) {
      read.resolve({ data: [{ kind: 'isolated' }], error: null });
    }
    await expect(Promise.all(requests)).resolves.toHaveLength(6);
  });

  it('keeps a preview read out of a pending production flight', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const rpcImpl = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockReturnValue(pending.promise);
    vi.stubEnv('VERCEL_ENV', 'production');
    const production = call('pending_env_fn', { p_slug: 'same' }, rpcImpl);
    await Promise.resolve();

    vi.stubEnv('VERCEL_ENV', 'preview');
    await expect(
      call('pending_env_fn', { p_slug: 'same' }, rpcImpl)
    ).resolves.toBeNull();
    expect(rpcImpl).toHaveBeenCalledTimes(1);
    pending.resolve({ data: [{ kind: 'production' }], error: null });
    await expect(production).resolves.toEqual({ kind: 'production' });
  });

  it('gates preview before memo and does not borrow a production verdict', async () => {
    const rpcImpl = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockResolvedValue({ data: [{ kind: 'production' }], error: null });
    vi.stubEnv('VERCEL_ENV', 'production');
    await expect(call('env_fn', { p_slug: 'same' }, rpcImpl)).resolves.toEqual({
      kind: 'production',
    });

    vi.stubEnv('VERCEL_ENV', 'preview');
    await expect(
      call('env_fn', { p_slug: 'same' }, rpcImpl)
    ).resolves.toBeNull();
    expect(rpcImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the same args snapshot for the flight key and deferred RPC payload', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const rpcImpl = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockReturnValue(pending.promise);
    const args = { p_identifier: 'before.example', p_slug: 'before' };

    const request = call('snapshot_fn', args, rpcImpl);
    args.p_identifier = 'after.example';
    args.p_slug = 'after';
    await Promise.resolve();

    expect(rpcImpl).toHaveBeenCalledWith(
      'snapshot_fn',
      { p_identifier: 'before.example', p_slug: 'before' },
      expect.any(AbortSignal)
    );
    pending.resolve({ data: [{ kind: 'before' }], error: null });
    await expect(request).resolves.toEqual({ kind: 'before' });
  });

  it('captures empty-result semantics before the flight owner is deferred', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const options = {
      emptyResult: 'unknown' as 'unknown' | undefined,
      failOpenContext: {
        surface: 'product-slug' as const,
        identifier: 'before.example',
        slug: 'before',
      },
      rpcImpl: vi
        .fn<StorefrontPreflightRpcImpl>()
        .mockReturnValue(pending.promise),
    };
    const request = callStorefrontPreflightRpc(
      'empty_snapshot_fn',
      {},
      options
    );
    options.emptyResult = undefined;
    await Promise.resolve();
    pending.resolve({ data: [], error: null });

    await expect(request).resolves.toBeNull();
    expect(console.warn).not.toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse' })
    );
  });

  it('captures fail-open context before the flight owner is deferred', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const options = {
      failOpenContext: {
        surface: 'product-slug' as const,
        identifier: 'before.example',
        slug: 'before',
      },
      rpcImpl: vi
        .fn<StorefrontPreflightRpcImpl>()
        .mockReturnValue(pending.promise),
    };
    const request = callStorefrontPreflightRpc(
      'context_snapshot_fn',
      {},
      options
    );
    options.failOpenContext.identifier = 'after.example';
    await Promise.resolve();
    pending.reject(new Error('outage'));

    await expect(request).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ identifier: 'before.example' })
    );
  });

  it('returns one shared fail-open result and permits a retry after rejection', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const rpcImpl = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockReturnValue(pending.promise);
    const args = { p_slug: 'retry' };
    const requests = Array.from({ length: 10 }, () =>
      call('retry_fn', args, rpcImpl)
    );
    await Promise.resolve();
    pending.reject(new Error('outage'));

    await expect(Promise.all(requests)).resolves.toEqual(Array(10).fill(null));
    expect(rpcImpl).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    rpcImpl.mockResolvedValue({ data: [{ kind: 'retry' }], error: null });
    await expect(call('retry_fn', args, rpcImpl)).resolves.toEqual({
      kind: 'retry',
    });
    expect(rpcImpl).toHaveBeenCalledTimes(2);
  });

  it('shares a timeout fail-open and retains its short timeout memo', async () => {
    const rpcImpl = vi
      .fn<StorefrontPreflightRpcImpl>()
      .mockRejectedValue(new DOMException('slow', 'TimeoutError'));
    const requests = Array.from({ length: 10 }, () =>
      call('timeout_fn', { p_slug: 'slow' }, rpcImpl)
    );

    await expect(Promise.all(requests)).resolves.toEqual(Array(10).fill(null));
    await expect(
      call('timeout_fn', { p_slug: 'slow' }, rpcImpl)
    ).resolves.toBeNull();
    expect(rpcImpl).toHaveBeenCalledTimes(1);
  });
});
