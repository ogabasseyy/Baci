import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createRedvaultRefundRecoveryTestTransport } from './redvault-refund-recovery-test-transport';

const restrictedTestJwt =
  'e30.eyJhdWQiOiJsb2NhbCIsInJvbGUiOiJyZWR2YXVsdF9yZWZ1bmRfdGVzdCJ9.signature';

describe('REDVAULT refund recovery test transport', () => {
  it('rejects a live Paystack key before constructing a provider or claiming refunds', () => {
    const fetcher = vi.fn<typeof fetch>();

    expect(() =>
      createRedvaultRefundRecoveryTestTransport({
        databaseUrl: 'http://127.0.0.1:54321',
        fetcher,
        providerKey: 'sk_live_not_allowed',
        restrictedTestJwt,
      })
    ).toThrow('requires a Paystack test key');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('constructs RPC requests only against the validated local origin', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const transport = createRedvaultRefundRecoveryTestTransport({
      databaseUrl: 'http://127.0.0.1:54321',
      fetcher,
      providerKey: 'sk_test_refund_runner',
      restrictedTestJwt,
    });

    await expect(transport.store.claimNext()).resolves.toBeNull();

    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        'http://127.0.0.1:54321/rest/v1/rpc/claim_next_uba_redvault_refund'
      ),
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
      })
    );
  });

  it('rejects remote, credentialed, or path-bearing database URLs before RPC construction', () => {
    for (const databaseUrl of [
      'https://project.supabase.co',
      'http://operator:password@127.0.0.1:54321',
      'http://127.0.0.1:54321/rest/v1',
      'http://127.0.0.1:54321?redirect=https://production.example',
    ]) {
      expect(() =>
        createRedvaultRefundRecoveryTestTransport({
          databaseUrl,
          providerKey: 'sk_test_refund_runner',
          restrictedTestJwt,
        })
      ).toThrow('requires a local test database');
    }
  });

  it('fails closed when the local RPC response is not an object, array, or null', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify('unexpected body'), { status: 200 })
      );
    const transport = createRedvaultRefundRecoveryTestTransport({
      databaseUrl: 'http://localhost:54321',
      fetcher,
      providerKey: 'sk_test_refund_runner',
      restrictedTestJwt,
    });

    await expect(transport.store.claimNext()).rejects.toThrow(
      'Unable to claim REDVAULT refund: REDVAULT refund RPC response invalid'
    );
  });

  it('rejects an unbound JWT and denies RPC names outside the refund surface', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() =>
      createRedvaultRefundRecoveryTestTransport({
        databaseUrl: 'http://localhost:54321',
        fetcher,
        providerKey: 'sk_test_refund_runner',
        restrictedTestJwt: 'e30.e30.signature',
      })
    ).toThrow('requires a restricted test JWT');

    const transport = createRedvaultRefundRecoveryTestTransport({
      databaseUrl: 'http://localhost:54321',
      fetcher,
      providerKey: 'sk_test_refund_runner',
      restrictedTestJwt,
    });
    const rpcClient = Reflect.get(transport.store as object, 'client') as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    };

    await expect(rpcClient.rpc('unrelated_rpc', {})).resolves.toEqual({
      data: null,
      error: { message: 'REDVAULT refund RPC denied' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
