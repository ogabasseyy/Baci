import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { RunnerCapacityError } from '../../tools/experience-runner/runner-transport';
import { createVerifierBuildClient } from '../../tools/experience-verifier/build-client';
import { createVerifierBuildHandler } from '../../tools/experience-verifier/build-handler';
import { startVerifierListener } from '../../tools/experience-verifier/listener';

const id = '11111111-1111-4111-8111-111111111111';
const key = new Uint8Array(32).fill(7);
const receipt = {
  merchantId: id,
  jobId: id,
  attemptNonce: id,
  buildDigest: 'b'.repeat(64),
  receiptDigest: 'c'.repeat(64),
  hostOrigin: 'https://shop.synthetic.test',
};
it('revalidates owner access and sends only identifiers to the fixed verifier port', async () => {
  const user = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
    rpc: vi.fn(() => {
      const result = Promise.resolve({ data: true, error: null });
      return Object.assign(result, { abortSignal: () => result });
    }),
  };
  const verify = vi.fn<
    Parameters<typeof createVerifierBuildHandler>[0]['verify']
  >(async () => {});
  const handler = createVerifierBuildHandler({
    key,
    consumeNonce: async () => true,
    resolveUserClient: async () => user as never,
    verify,
  });
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 404 }),
    0,
    handler
  );
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const resolveToken = vi.fn(async () => 'synthetic.token');
    const client = createVerifierBuildClient({
      key,
      port: address.port,
      resolveLinkedAccessToken: resolveToken,
    });
    const identity = {
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      scopes: new Set(['storefront.write' as const]),
      allowedMerchantIds: [id],
      allowCreateStore: false,
    };
    const ctx = {
      merchantId: id,
      supabase: user as never,
      identity,
      actorUserId: id,
    };
    await client(receipt, ctx);
    expect(verify).toHaveBeenCalledOnce();
    expect(resolveToken).toHaveBeenCalledWith(identity);
    expect(user.rpc).toHaveBeenCalledTimes(2);
    await expect(
      client(
        { ...receipt, merchantId: '22222222-2222-4222-8222-222222222222' },
        ctx
      )
    ).rejects.toThrow();
    expect(verify).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: disconnected, resolve: disconnect } =
      Promise.withResolvers<void>();
    verify.mockImplementationOnce(async (_client, _receipt, signal) => {
      signal?.addEventListener('abort', () => disconnect(), { once: true });
      enter();
      await disconnected;
    });
    const pending = client(receipt, { ...ctx, signal: controller.signal });
    const denied = expect(pending).rejects.toThrow('VERIFIER_UNAVAILABLE');
    await Promise.race([entered, pending]);
    controller.abort();
    await denied;
    await disconnected;
  } finally {
    await listener.close();
  }
});

it('retries capacity rejection and reconciles a lost response only with the exact receipt', async () => {
  const filters: Record<string, string> = {};
  const expected: Record<string, string> = {
    merchant_id: receipt.merchantId,
    job_id: receipt.jobId,
    attempt_nonce: receipt.attemptNonce,
    build_digest: receipt.buildDigest,
    receipt_digest: receipt.receiptDigest,
    host_origin: receipt.hostOrigin,
  };
  let stored = false;
  const query = {
    select: () => query,
    eq: (key: string, value: string) => {
      filters[key] = value;
      return query;
    },
    maybeSingle: async () => ({
      data:
        stored &&
        Object.entries(expected).every(([key, val]) => filters[key] === val)
          ? { id }
          : null,
      error: null,
    }),
  };
  const user = {
    auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      expect(table).toBe('experience_evidence');
      return query;
    },
  };
  const verify = vi.fn(async () => {});
  verify.mockRejectedValueOnce(new RunnerCapacityError());
  const authorized = createVerifierBuildHandler({
    key,
    consumeNonce: async () => true,
    resolveUserClient: async () => user as never,
    verify,
  });
  let unavailable = false;
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 404 }),
    0,
    (request) =>
      unavailable
        ? Promise.resolve(new Response(null, { status: 503 }))
        : authorized(request)
  );
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const client = createVerifierBuildClient({
      key,
      port: address.port,
      resolveLinkedAccessToken: async () => 'synthetic.token',
    });
    const ctx = {
      merchantId: id,
      actorUserId: id,
      supabase: user as never,
      identity: {
        actorUserId: id,
        connectionId: id,
        grantVersion: 1,
        scopes: new Set(['storefront.write' as const]),
        allowedMerchantIds: [id],
        allowCreateStore: false,
      },
    };
    await client(receipt, ctx);
    expect(verify).toHaveBeenCalledTimes(2);

    unavailable = true;
    await expect(client(receipt, ctx)).rejects.toThrow('VERIFIER_UNAVAILABLE');
    stored = true;
    await expect(client(receipt, ctx)).resolves.toBeUndefined();
    expect(filters).toEqual(expected);
    await expect(
      client({ ...receipt, receiptDigest: 'd'.repeat(64) }, ctx)
    ).rejects.toThrow('VERIFIER_UNAVAILABLE');
  } finally {
    await listener.close();
  }
});
