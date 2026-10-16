import { describe, expect, it, vi } from 'vitest';

import {
  createHandoffToken,
  hashHandoffToken,
  redeemCartHandoff,
} from './handoff';

const SECRET = 'test-handoff-secret-min-32-chars!!!!';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const CART_ID = '22222222-2222-4222-8222-222222222222';

const GRANT_ID = '33333333-3333-4333-8333-333333333333';

const TOKEN_INPUT = {
  cartId: CART_ID,
  destination: { type: 'web' as const },
  environment: 'test',
  merchantId: MERCHANT_ID,
  operationId: 'handoff-op-1',
  principalId: 'guest-origin',
};

function rawLine(overrides: Record<string, unknown> = {}) {
  return {
    assuranceRate: null,
    available: true,
    condition: null,
    hasAssurance: false,
    id: 'line-1',
    manageStock: false,
    negotiatedUnitPriceMinor: null,
    negotiationInvalidated: false,
    negotiationStatus: null,
    options: {},
    productId: '44444444-4444-4444-8444-444444444444',
    quantity: 1,
    stockQty: null,
    unitPriceMinor: 1500,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
    ...overrides,
  };
}

function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [rawLine()],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 3,
    ...overrides,
  };
}

describe('redeemCartHandoff', () => {
  function clientReturning(payload: unknown, error: unknown = null) {
    return { rpc: vi.fn(async () => ({ data: payload, error })) };
  }

  const token = createHandoffToken(TOKEN_INPUT, SECRET);

  it('redeems by hash and prices the resulting snapshot', async () => {
    const client = clientReturning({
      choice: 'connect',
      code: null,
      currentVersion: 3,
      grantId: GRANT_ID,
      grantExpiresAt: '2026-10-20T04:00:00Z',
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await redeemCartHandoff(client as never, {
      attemptId: 'attempt-1',
      caller: 'web',
      choice: 'connect',
      expectedIncomingVersion: 3,
      handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      token,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.choice).toBe('connect');
      expect(result.grantId).toBe(GRANT_ID);
      expect(result.grantExpiresAt).toBe('2026-10-20T04:00:00Z');
      expect(result.cart?.version).toBe(3);
      expect(result.cart?.totalMinor).toBe(1500);
    }
  });

  it('succeeds without a snapshot when no destination cart exists', async () => {
    const client = clientReturning({
      choice: 'keep_existing',
      code: null,
      currentVersion: null,
      grantId: null,
      ok: true,
      replayed: false,
      state: null,
    });

    const result = await redeemCartHandoff(client as never, {
      attemptId: 'attempt-keep',
      caller: 'web',
      choice: 'keep_existing',
      handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      token,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cart).toBeNull();
      expect(result.grantId).toBeNull();
    }
    const [rpcName, args] = client.rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(rpcName).toBe('commerce_cart_redeem_handoff');
    expect(args.p_token_hash).toBe(hashHandoffToken(token));
    expect(JSON.stringify(args)).not.toContain('ch1.');
  });

  it('surfaces merge conflicts with both attachment sets', async () => {
    const client = clientReturning({
      code: 'merge_conflict',
      conflicts: [
        {
          existing: { negotiatedUnitPriceMinor: 22000, quantity: 1 },
          incoming: { negotiatedUnitPriceMinor: 20000, quantity: 1 },
          item: { productId: '33333333-3333-4333-8333-333333333333' },
        },
      ],
      ok: false,
      replayed: false,
      state: rawState(),
    });

    const result = await redeemCartHandoff(client as never, {
      attemptId: 'attempt-1',
      caller: 'web',
      choice: 'merge',
      destCartId: CART_ID,
      expectedDestVersion: 2,
      expectedIncomingVersion: 3,
      handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lines: [],
      token,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('merge_conflict');
      expect(result.conflicts).toHaveLength(1);
    }
  });
});
it('passes opaque handoff selectors through to the scoped RPC without rewriting them as attachment inputs', async () => {
  const { redeemCartHandoff: rpcRedeemCartHandoff } = await import(
    './handoff-redeem'
  );
  const lines = [
    {
      item: { productId: '44444444-4444-4444-8444-444444444444' },
      sourceLineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quantity: 2,
    },
  ];
  const rpc = vi.fn().mockResolvedValue({
    data: { ok: false, code: 'version_conflict' },
    error: null,
  });
  await rpcRedeemCartHandoff({ rpc } as never, {
    token: 'ch1.payload.signature',
    handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    attemptId: 'opaque-attempt',
    caller: 'web',
    choice: 'merge',
    lines,
    expectedDestVersion: 2,
    expectedIncomingVersion: 3,
  });
  expect(rpc).toHaveBeenCalledWith(
    'commerce_cart_redeem_handoff',
    expect.objectContaining({
      p_lines: lines,
      p_expected_dest_version: 2,
      p_expected_incoming_version: 3,
    })
  );
});
