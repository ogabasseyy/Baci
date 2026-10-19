import { describe, expect, it, vi } from 'vitest';

import { HandoffConfigError, issueCartHandoff } from './handoff';

import type { CartPrincipal } from './principal';

const SECRET = 'test-handoff-secret-min-32-chars!!!!';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const CART_ID = '22222222-2222-4222-8222-222222222222';

const GRANT_ID = '33333333-3333-4333-8333-333333333333';

function sessionPrincipal(): CartPrincipal {
  return {
    allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
    cartId: CART_ID,
    grantId: GRANT_ID,
    merchantId: MERCHANT_ID,
    principalId: 'guest-origin',
    scope: 'session',
  } as CartPrincipal;
}

describe('issueCartHandoff', () => {
  function clientReturning(payload: unknown, error: unknown = null) {
    return { rpc: vi.fn(async () => ({ data: payload, error })) };
  }

  it('issues a grant by hash and returns a continuation URL', async () => {
    const client = clientReturning({
      code: null,
      handoff: {
        expiresAt: '2026-10-12T06:05:00.000Z',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      ok: true,
      replayed: false,
    });

    const result = await issueCartHandoff(
      {
        client: client as never,
        environment: 'test',
        merchant: {
          customDomain: null,
          rootDomain: 'usebaci.com',
          slug: 'ogabassey',
        },
        secret: SECRET,
      },
      sessionPrincipal(),
      { destination: { type: 'web' }, operationId: 'handoff-op-1' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handoffId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(result.replayed).toBe(false);
      expect(result.continueUrl).toContain('/cart#handoff=ch1.');
    }
    const [rpcName, args] = client.rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(rpcName).toBe('commerce_cart_issue_handoff');
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain('ch1.');
  });

  it('passes replays and failures through without minting', async () => {
    const depsFor = (payload: unknown) => ({
      client: clientReturning(payload) as never,
      environment: 'test',
      merchant: {
        customDomain: null,
        rootDomain: 'usebaci.com',
        slug: 'ogabassey',
      },
      secret: SECRET,
    });

    const replayed = await issueCartHandoff(
      depsFor({
        code: null,
        handoff: {
          expiresAt: '2026-10-12T06:05:00.000Z',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        ok: true,
        replayed: true,
      }),
      sessionPrincipal(),
      { destination: { type: 'web' }, operationId: 'handoff-op-1' }
    );
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(replayed.replayed).toBe(true);
    }

    const consumed = await issueCartHandoff(
      depsFor({ code: 'handoff_consumed', ok: false, replayed: false }),
      sessionPrincipal(),
      { destination: { type: 'web' }, operationId: 'handoff-op-1' }
    );
    expect(consumed).toEqual({ code: 'handoff_consumed', ok: false });
  });

  it('rejects bootstrap principals and malformed destinations', async () => {
    const deps = {
      client: clientReturning({}) as never,
      environment: 'test',
      merchant: {
        customDomain: null,
        rootDomain: 'usebaci.com',
        slug: 'ogabassey',
      },
      secret: SECRET,
    };
    const bootstrap = {
      ...sessionPrincipal(),
      cartId: null,
      grantId: null,
      scope: 'bootstrap',
    } as unknown as CartPrincipal;

    const noCart = await issueCartHandoff(deps, bootstrap, {
      destination: { type: 'web' },
      operationId: 'handoff-op-1',
    });
    expect(noCart).toEqual({ code: 'unauthorized', ok: false });

    const badDestination = await issueCartHandoff(deps, sessionPrincipal(), {
      destination: { type: 'native' },
      operationId: 'handoff-op-1',
    });
    expect(badDestination).toEqual({ code: 'invalid_item', ok: false });
  });

  it('fails closed without a provisioned secret', async () => {
    await expect(
      issueCartHandoff(
        {
          client: clientReturning({}) as never,
          environment: 'test',
          merchant: {
            customDomain: null,
            rootDomain: 'usebaci.com',
            slug: 'ogabassey',
          },
          secret: undefined,
        },
        sessionPrincipal(),
        { destination: { type: 'web' }, operationId: 'handoff-op-1' }
      )
    ).rejects.toBeInstanceOf(HandoffConfigError);
  });
});

it('bounds unrecognized handoff RPC codes before returning them to a route', async () => {
  for (const code of [
    'unexpected_database_detail',
    42,
    { secret: 'fixture' },
  ]) {
    const client = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { ok: false, code }, error: null }),
    };
    const result = await issueCartHandoff(
      {
        client: client as never,
        environment: 'test',
        merchant: {
          customDomain: null,
          rootDomain: 'usebaci.com',
          slug: 'ogabassey',
        },
        secret: SECRET,
      },
      sessionPrincipal(),
      { destination: { type: 'web' }, operationId: 'bounded-error' }
    );
    expect(result).toEqual({ ok: false, code: 'temporarily_unavailable' });
  }
});
