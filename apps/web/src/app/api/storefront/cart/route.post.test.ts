import { describe, expect, it, vi } from 'vitest';
import { CART_QUOTA_BUDGETS, checkCartQuota } from '@/lib/cart/request-context';
import * as sessionProofModule from '@/lib/cart/session-proof';
import {
  CART_SESSION_PROOF_TTL_SECONDS,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import {
  bootstrapProof,
  bootstrapProofFor,
  CART_ID,
  cartCookie,
  GRANT_ID,
  MERCHANT,
  mocks,
  OTHER_MERCHANT,
  PRODUCT_ID,
  postCart,
  rawLine,
  rawState,
  sessionProof,
  TEST_SECRET,
} from './route.test-support';

describe('POST /api/storefront/cart', () => {
  it.each([
    'web',
    'native',
  ])('retries committed creation when %s session proof issuance fails', async (surface) => {
    const bootstrap = bootstrapProof();
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const mint = vi
      .spyOn(sessionProofModule, 'issueCartSessionProof')
      .mockImplementationOnce(() => {
        throw new Error('fixture mint failure');
      });
    const headers: Record<string, string> =
      surface === 'web'
        ? { cookie: cartCookie(bootstrap) }
        : { authorization: `Bearer ${bootstrap}` };
    const request = {
      body: { operationId: 'create-proof-retry' },
      headers,
      noCsrf: surface === 'native',
    };
    const failed = await postCart(request);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: 'temporarily_unavailable',
    });
    expect(failed.headers.get('set-cookie')).toBeNull();
    mint.mockRestore();
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: true,
      state: rawState(),
    };
    const retried = await postCart(request);
    expect(retried.status).toBe(201);
    const payload = await retried.json();
    expect(payload).toMatchObject({
      operationId: 'create-proof-retry',
      replayed: true,
      cart: { cartId: CART_ID },
    });
    const proof =
      surface === 'native'
        ? payload.proof
        : (retried.headers.get('set-cookie') ?? '').match(
            /baci-cart-[^=]+=([^;]+)/
          )?.[1];
    expect(
      verifyCartSessionProof(proof, {
        environment: 'test',
        secret: TEST_SECRET,
      }).ok
    ).toBe(true);
  });

  it('lazily creates a cart and upgrades to a session proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T04:00:00Z'));
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };

    const response = await postCart({
      body: {
        lines: [{ item: { productId: PRODUCT_ID }, quantity: 2 }],
        operationId: 'create-1',
      },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.operationId).toBe('create-1');
    expect(payload.replayed).toBe(false);
    expect(payload.cart.cartId).toBe(CART_ID);

    // Web callers receive the upgraded session proof only via the
    // httpOnly cookie.
    expect(payload.proof).toBeUndefined();
    const setCookie = response.headers.get('set-cookie') ?? '';
    const cookieProof = setCookie.match(/baci-cart-[^=]+=([^;]+)/)?.[1] ?? '';
    const verified = verifyCartSessionProof(cookieProof, {
      environment: 'test',
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.merchantId).toBe(MERCHANT.id);
      expect(verified.session.cartId).toBe(CART_ID);
      expect(verified.session.grantId).toBe(GRANT_ID);
    }
    expect(setCookie).toContain(
      `baci-cart-11111111-1111-4111-8111-111111111111=${cookieProof}`
    );
    expect(setCookie).toContain(`Max-Age=${CART_SESSION_PROOF_TTL_SECONDS}`);
    expect(mocks.capturedPrincipal).toMatchObject({ scope: 'bootstrap' });
  });

  it('creates for native clients presenting a Bearer bootstrap proof', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await postCart({
      body: { operationId: 'create-native' },
      headers: { authorization: `Bearer ${bootstrapProof()}` },
      noCsrf: true,
    });

    expect(response.status).toBe(201);
    expect((await response.json()).operationId).toBe('create-native');
  });

  it('never lets client JSON override the resolved merchant', async () => {
    const response = await postCart({
      body: { merchantId: OTHER_MERCHANT.id, operationId: 'create-9' },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_request');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('forbids creation for proofs that already hold a cart', async () => {
    const response = await postCart({
      body: { operationId: 'create-9' },
      headers: { cookie: cartCookie(sessionProof()) },
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('unauthorized');
  });

  it('rejects browser requests without a CSRF token', async () => {
    const response = await postCart({
      body: { operationId: 'create-9' },
      headers: { cookie: cartCookie(bootstrapProof()) },
      noCsrf: true,
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
  });

  it('maps invalid lines and idempotency conflicts', async () => {
    const invalid = await postCart({
      body: {
        lines: [{ item: { productId: 'not-a-uuid' }, quantity: 1 }],
        operationId: 'create-9',
      },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('invalid_request');

    mocks.cartPayload = {
      code: 'idempotency_conflict',
      ok: false,
      replayed: false,
      state: null,
    };
    const conflict = await postCart({
      body: { operationId: 'create-1' },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('idempotency_conflict');
  });

  it('fails closed when creation succeeds without a grant id', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await postCart({
      body: { operationId: 'create-9' },
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('temporarily_unavailable');
  });

  it('bounds creation per merchant and principal', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const attempt = () =>
      postCart({
        body: { operationId: 'create-1' },
        headers: { cookie: cartCookie(bootstrapProof()) },
      });

    for (let index = 0; index < 10; index++) {
      expect((await attempt()).status).toBe(201);
    }
    const exhausted = await attempt();
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json()).code).toBe('quota_exceeded');
  });

  it('does not let rotating bootstrap proofs reset the create budget', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    // Every attempt presents a brand-new principal (a fresh bootstrap
    // proof), but all come from the same client identity.
    for (let index = 0; index < 10; index++) {
      const response = await postCart({
        body: { operationId: `create-rot-${index}` },
        headers: {
          cookie: cartCookie(bootstrapProofFor(`guest-rot-${index}`)),
        },
      });
      expect(response.status).toBe(201);
    }
    const exhausted = await postCart({
      body: { operationId: 'create-rot-10' },
      headers: { cookie: cartCookie(bootstrapProofFor('guest-rot-10')) },
    });
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json()).code).toBe('quota_exceeded');
  });

  it('gives distinct client credentials independent create budgets', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const credentialA = '11111111-1111-4111-8111-111111111111';
    const credentialB = '22222222-2222-4222-8222-222222222222';
    const attempt = (credential: string, index: number) =>
      postCart({
        body: { operationId: `create-cred-${index}` },
        headers: {
          cookie: cartCookie(bootstrapProofFor(`guest-cred-${index}`)),
          'x-baci-client-credential': credential,
        },
      });
    for (let index = 0; index < 10; index++) {
      expect((await attempt(credentialA, index)).status).toBe(201);
    }
    expect((await attempt(credentialA, 10)).status).toBe(429);
    // The second shopper behind the same network identity can create.
    expect((await attempt(credentialB, 11)).status).toBe(201);
  });

  it('bounds credential rotation with the network backstop', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    // Fill this network identity's backstop bucket directly (the
    // harness requests carry no platform address, so their trusted
    // network identity is the shared 'unknown' subject).
    for (
      let index = 0;
      index < CART_QUOTA_BUDGETS.create_network_backstop.limit;
      index++
    ) {
      await checkCartQuota({
        merchantId: MERCHANT.id,
        operation: 'create_network_backstop',
        subject: 'unknown',
      });
    }
    const response = await postCart({
      body: { operationId: 'create-rotated-credential' },
      headers: {
        cookie: cartCookie(bootstrapProofFor('guest-rotated')),
        'x-baci-client-credential': '33333333-3333-4333-8333-333333333333',
      },
    });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
  });
});
