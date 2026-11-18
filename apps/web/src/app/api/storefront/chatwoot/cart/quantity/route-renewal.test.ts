import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  grant: null as null | {
    allowedOperations: string[];
    grantExpiresAt: string;
  },
  issue: vi.fn(() => 'proof-token'),
  renew: vi.fn(async () => 'renewed-session-token'),
}));

vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: () => 'test',
}));
vi.mock('@/lib/cart/grant-operations', () => ({
  loadLiveGrantOperations: vi.fn(async () => mocks.grant),
}));
vi.mock('@/lib/cart/session-proof', () => ({
  cartSessionCookieMaxAge: () => 3600,
  issueCartSessionProof: mocks.issue,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  hashCartSessionProof: () => 'hash',
  renewChatwootSessionCapability: mocks.renew,
}));

import { renewAfterQuantityCommit } from './route-renewal';

const future = new Date(Date.now() + 3_600_000).toISOString();
const principal = {
  allowedOperations: ['set_quantity'],
  cartId: 'cart-1',
  expiresAt: future,
  grantId: 'grant-1',
  principalId: 'principal-1',
};

function input(overrides: { replayed?: boolean; getLatestCart?: unknown }) {
  return {
    cartContext: {
      binding: {},
      state: { cartVersion: 2, merchantId: 'merchant-1' },
    },
    client: {},
    getLatestCart:
      overrides.getLatestCart ??
      vi.fn(async () => ({
        ok: true,
        cart: {
          cartId: 'cart-1',
          expiresAt: future,
          merchantId: 'merchant-1',
          version: 3,
        },
      })),
    principal,
    result: {
      ok: true,
      replayed: overrides.replayed ?? false,
      cart: {
        cartId: 'cart-1',
        expiresAt: future,
        merchantId: 'merchant-1',
        version: 3,
      },
    },
    sessionToken: 'session-token',
  } as unknown as Parameters<typeof renewAfterQuantityCommit>[0];
}

describe('renewAfterQuantityCommit', () => {
  beforeEach(() => {
    mocks.grant = {
      allowedOperations: ['set_quantity'],
      grantExpiresAt: future,
    };
    mocks.issue.mockClear();
    mocks.renew.mockClear();
  });

  it('renews the proof and session token for a fresh commit', async () => {
    const renewal = await renewAfterQuantityCommit(input({}));
    expect(renewal.proof).toBe('proof-token');
    expect(renewal.sessionToken).toBe('renewed-session-token');
    expect(renewal.liveCartVersion).toBe(3);
  });

  it('skips renewal when the live grant cannot be loaded', async () => {
    mocks.grant = null;
    const renewal = await renewAfterQuantityCommit(input({}));
    expect(renewal.proof).toBeNull();
    expect(renewal.sessionToken).toBeNull();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('does not renew a replay when the live cart read throws', async () => {
    const renewal = await renewAfterQuantityCommit(
      input({
        replayed: true,
        getLatestCart: vi.fn(async () => {
          throw new Error('down');
        }),
      })
    );
    expect(renewal.liveCartVersion).toBeNull();
    expect(renewal.proof).toBeNull();
    expect(renewal.sessionToken).toBeNull();
  });
});
