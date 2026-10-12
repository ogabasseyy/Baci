import { describe, expect, it, vi } from 'vitest';
import {
  buildHandoffContinueUrl,
  createHandoffToken,
  detectHandoffCaller,
  HandoffConfigError,
  hashHandoffToken,
  isHandoffWebOriginAllowed,
  issueCartHandoff,
  parseHandoffToken,
  redeemCartHandoff,
  rpcPreviewHandoff,
} from './handoff';
import type { CartPrincipal } from './principal';

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

describe('handoff tokens', () => {
  it('mints deterministic versioned tokens for identical input', () => {
    const first = createHandoffToken(TOKEN_INPUT, SECRET);
    const second = createHandoffToken(TOKEN_INPUT, SECRET);

    expect(first).toBe(second);
    expect(first.startsWith('ch1.')).toBe(true);
    expect(first.split('.')).toHaveLength(3);
  });

  it('round-trips through parse with the same secret and environment', () => {
    const token = createHandoffToken(TOKEN_INPUT, SECRET);

    expect(parseHandoffToken(token, SECRET, 'test')).toEqual({
      cartId: CART_ID,
      destination: { type: 'web' },
      merchantId: MERCHANT_ID,
      operationId: 'handoff-op-1',
      principalId: 'guest-origin',
    });
  });

  it('rejects tampered tokens, wrong secrets and foreign environments', () => {
    const token = createHandoffToken(TOKEN_INPUT, SECRET);
    const [version, payload, signature] = token.split('.');

    expect(
      parseHandoffToken(token, 'wrong-secret-min-32-chars!!!!!!!!!', 'test')
    ).toBeNull();
    expect(parseHandoffToken(token, SECRET, 'production')).toBeNull();
    expect(
      parseHandoffToken(`${version}.${payload}X.${signature}`, SECRET, 'test')
    ).toBeNull();
    expect(
      parseHandoffToken('cp1.payload.signature', SECRET, 'test')
    ).toBeNull();
    expect(parseHandoffToken('not-a-token', SECRET, 'test')).toBeNull();
  });

  it('hashes tokens to stable hex digests', () => {
    const token = createHandoffToken(TOKEN_INPUT, SECRET);
    const hash = hashHandoffToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHandoffToken(token)).toBe(hash);
    expect(hashHandoffToken(`${token}X`)).not.toBe(hash);
  });
});

describe('buildHandoffContinueUrl', () => {
  it('keeps the pairing secret in the fragment, off access logs', () => {
    const url = buildHandoffContinueUrl(
      { customDomain: null, rootDomain: 'usebaci.com', slug: 'ogabassey' },
      'ch1.payload.signature',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(url).toBe(
      'https://ogabassey.usebaci.com/cart#handoff=ch1.payload.signature&hid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    const [base, fragment] = url.split('#');
    expect(base).not.toContain('ch1.');
    expect(fragment).toContain('handoff=');
  });

  it('prefers the merchant custom domain for the continuation host', () => {
    const url = buildHandoffContinueUrl(
      {
        customDomain: 'Shop.Example.com',
        rootDomain: 'usebaci.com',
        slug: 'ogabassey',
      },
      'ch1.payload.signature',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(url.startsWith('https://shop.example.com/cart#')).toBe(true);
  });
});

describe('handoff destination checks', () => {
  it('detects browser callers from http origins', () => {
    expect(detectHandoffCaller('https://ogabassey.usebaci.com')).toBe('web');
    expect(detectHandoffCaller('http://localhost:3000')).toBe('web');
    expect(detectHandoffCaller(null)).toBe('native');
    expect(detectHandoffCaller('capacitor://localhost')).toBe('native');
  });

  it('allows only the merchant approved web origins', () => {
    const merchant = {
      customDomain: 'shop.example.com',
      rootDomain: 'usebaci.com',
      slug: 'ogabassey',
    };

    expect(
      isHandoffWebOriginAllowed('https://ogabassey.usebaci.com', merchant)
    ).toBe(true);
    expect(
      isHandoffWebOriginAllowed('https://shop.example.com', merchant)
    ).toBe(true);
    expect(isHandoffWebOriginAllowed('https://usebaci.com', merchant)).toBe(
      true
    );
    expect(
      isHandoffWebOriginAllowed('https://evil.example.com', merchant)
    ).toBe(false);
    expect(isHandoffWebOriginAllowed(null, merchant)).toBe(false);
  });
});

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

describe('rpcPreviewHandoff', () => {
  function clientReturning(payload: unknown, error: unknown = null) {
    return { rpc: vi.fn(async () => ({ data: payload, error })) };
  }

  it('parses pending previews with priced snapshots', async () => {
    const result = await rpcPreviewHandoff(
      clientReturning({
        code: null,
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
        ok: true,
        snapshot: rawState(),
        status: 'pending',
      }) as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('pending');
      expect(result.snapshot?.lines).toHaveLength(1);
      expect(result.merchant).toEqual({ id: MERCHANT_ID, slug: 'ogabassey' });
    }
  });

  it('reports consumed, expired and unknown links', async () => {
    for (const status of ['consumed', 'expired'] as const) {
      const result = await rpcPreviewHandoff(
        clientReturning({
          code: null,
          expiresAt: '2026-10-12T06:05:00.000Z',
          ok: true,
          status,
        }) as never,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      );
      expect(result).toMatchObject({ ok: true, status });
    }
    const missing = await rpcPreviewHandoff(
      clientReturning({ code: 'not_found', ok: false }) as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    expect(missing).toEqual({ code: 'not_found', ok: false });
  });
});
