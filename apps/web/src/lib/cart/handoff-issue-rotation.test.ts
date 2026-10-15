import { afterEach, expect, it, vi } from 'vitest';
import { issueCartHandoff } from './handoff';
import { createHandoffToken, hashHandoffToken } from './handoff-token';
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
afterEach(() => vi.unstubAllEnvs());
it('recovers a committed issue after rotation using the previous key and exact operation', async () => {
  const previous = 'previous-fixture-signing-key-at-least-32';
  vi.stubEnv(
    'CART_SESSION_PREVIOUS_SECRETS',
    JSON.stringify([{ retireAt: '2099-01-01T00:00:00Z', secret: previous }])
  );
  const oldToken = createHandoffToken(
    {
      cartId: CART_ID,
      merchantId: MERCHANT_ID,
      principalId: 'guest-origin',
      operationId: 'lost-response',
      destination: { type: 'web' },
      environment: 'test',
    },
    previous
  );
  const client = {
    rpc: vi.fn(async (_name: string, args: { p_token_hash: string }) => ({
      error: null,
      data:
        args.p_token_hash === hashHandoffToken(oldToken)
          ? {
              ok: true,
              replayed: true,
              handoff: { id: GRANT_ID, expiresAt: '2026-10-15T12:00:00Z' },
            }
          : { ok: false, code: 'idempotency_conflict' },
    })),
  };
  const result = await issueCartHandoff(
    {
      client: client as never,
      secret: SECRET,
      environment: 'test',
      merchant: {
        slug: 'ogabassey',
        rootDomain: 'usebaci.com',
        customDomain: null,
      },
    },
    sessionPrincipal(),
    { destination: { type: 'web' }, operationId: 'lost-response' }
  );
  expect(result.ok).toBe(true);
  expect(result.replayed).toBe(true);
  expect(result.continueUrl).toContain(encodeURIComponent(oldToken));
  expect(client.rpc).toHaveBeenCalledTimes(2);
});

it('does not retry an indeterminate issue or a definitive expired grant across signing keys', async () => {
  vi.stubEnv(
    'CART_SESSION_PREVIOUS_SECRETS',
    JSON.stringify([
      {
        retireAt: '2099-01-01T00:00:00Z',
        secret: 'previous-fixture-signing-key-at-least-32',
      },
    ])
  );
  for (const reply of [
    { error: null, data: { ok: false, code: 'expired' } },
    { error: { message: 'transport failed' }, data: null },
  ]) {
    const client = { rpc: vi.fn(async () => reply) };
    const attempt = issueCartHandoff(
      {
        client: client as never,
        secret: SECRET,
        environment: 'test',
        merchant: {
          slug: 'ogabassey',
          rootDomain: 'usebaci.com',
          customDomain: null,
        },
      },
      sessionPrincipal(),
      { destination: { type: 'web' }, operationId: 'same-operation' }
    );
    if (reply.error) await expect(attempt).rejects.toThrow('Cart RPC');
    else
      await expect(attempt).resolves.toMatchObject({
        ok: false,
        code: 'expired',
      });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  }
});

it('keeps changed operation bodies conflicted across the approved key ring', async () => {
  vi.stubEnv(
    'CART_SESSION_PREVIOUS_SECRETS',
    JSON.stringify([
      {
        retireAt: '2099-01-01T00:00:00Z',
        secret: 'previous-fixture-signing-key-at-least-32',
      },
    ])
  );
  const client = {
    rpc: vi.fn(async () => ({
      error: null,
      data: { ok: false, code: 'idempotency_conflict' },
    })),
  };
  const result = await issueCartHandoff(
    {
      client: client as never,
      secret: SECRET,
      environment: 'test',
      merchant: {
        slug: 'ogabassey',
        rootDomain: 'usebaci.com',
        customDomain: null,
      },
    },
    sessionPrincipal(),
    {
      destination: { type: 'native', app: 'storefront' },
      operationId: 'same-operation-different-destination',
    }
  );
  expect(result).toEqual({ ok: false, code: 'idempotency_conflict' });
  expect(client.rpc).toHaveBeenCalledTimes(2);
});
