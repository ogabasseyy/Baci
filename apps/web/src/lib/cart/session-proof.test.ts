import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCartProofEnvironment } from './cart-runtime-env';

afterEach(() => vi.unstubAllEnvs());

import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  CART_SESSION_PROOF_TTL_SECONDS,
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from './session-proof';

const SECRET = 'test-cart-session-secret-with-enough-length-001';
const ROTATED_SECRET = 'test-cart-session-secret-with-enough-length-002';
const ENVIRONMENT = 'test';
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL_ID = 'guest-principal-001';

function sessionInput() {
  return {
    cartId: CART_ID,
    grantId: GRANT_ID,
    merchantId: MERCHANT_ID,
    principalId: PRINCIPAL_ID,
    scope: 'session' as const,
  };
}

describe('cartSessionCookieMaxAge', () => {
  const now = new Date('2026-10-14T00:00:00.000Z');

  it('caps the cookie at the cart expiry when it is sooner than the proof TTL', () => {
    expect(cartSessionCookieMaxAge('2026-10-14T01:00:00.000Z', now)).toBe(3600);
  });

  it('caps the cookie at the proof TTL for long-lived carts', () => {
    expect(cartSessionCookieMaxAge('2026-10-21T00:00:00.000Z', now)).toBe(
      CART_SESSION_PROOF_TTL_SECONDS
    );
  });

  it('is non-positive once the cart has expired', () => {
    expect(
      cartSessionCookieMaxAge('2026-10-13T23:59:00.000Z', now)
    ).toBeLessThanOrEqual(0);
  });
});

describe('issueCartSessionProof', () => {
  it('issues a versioned proof that verifies with the same secret', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    expect(proof.startsWith('cp1.')).toBe(true);

    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.merchantId).toBe(MERCHANT_ID);
      expect(verified.session.cartId).toBe(CART_ID);
      expect(verified.session.grantId).toBe(GRANT_ID);
      expect(verified.session.principalId).toBe(PRINCIPAL_ID);
    }
  });

  it('caps session proof lifetime at the configured TTL', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });
    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:01Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      const lifetime =
        (Date.parse(verified.session.expiresAt) -
          Date.parse('2026-10-12T04:00:00Z')) /
        1000;
      expect(lifetime).toBeLessThanOrEqual(CART_SESSION_PROOF_TTL_SECONDS);
    }
  });

  it('caps proof expiry at the grant expiry when it is sooner', () => {
    const grantExpiresAt = '2026-10-12T05:00:00Z';
    const proof = issueCartSessionProof(
      { ...sessionInput(), grantExpiresAt },
      {
        environment: ENVIRONMENT,
        now: new Date('2026-10-12T04:00:00Z'),
        secret: SECRET,
      }
    );
    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:30:00Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(Date.parse(verified.session.expiresAt)).toBe(
        Date.parse(grantExpiresAt)
      );
    }
  });

  it('issues short-lived bootstrap proofs without cart or grant', () => {
    const proof = issueCartSessionProof(
      {
        cartId: null,
        grantId: null,
        merchantId: MERCHANT_ID,
        principalId: PRINCIPAL_ID,
        scope: 'bootstrap',
      },
      {
        environment: ENVIRONMENT,
        now: new Date('2026-10-12T04:00:00Z'),
        secret: SECRET,
      }
    );
    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:01Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.cartId).toBeNull();
      expect(verified.session.grantId).toBeNull();
      expect(verified.session.allowedOperations).toEqual([]);
      const lifetime =
        (Date.parse(verified.session.expiresAt) -
          Date.parse('2026-10-12T04:00:00Z')) /
        1000;
      expect(lifetime).toBeLessThanOrEqual(CART_BOOTSTRAP_PROOF_TTL_SECONDS);
    }
  });

  it('grants ordinary cart operations to session proofs', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });
    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:01Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.session.allowedOperations).toEqual([
        'add',
        'set_quantity',
        'remove',
        'clear',
        'replace',
        'set_assurance',
        'set_negotiated_price',
      ]);
    }
  });

  it('carries a restricted grant operation set through verification', () => {
    const proof = issueCartSessionProof(
      { ...sessionInput(), allowedOperations: ['add', 'remove'] },
      {
        environment: ENVIRONMENT,
        now: new Date('2026-10-12T04:00:00Z'),
        secret: SECRET,
      }
    );
    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:01Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      // The TypeScript authority is exactly the grant's: a restricted
      // grant must not widen back to the full vocabulary at this layer.
      expect(verified.session.allowedOperations).toEqual(['add', 'remove']);
    }
  });

  it('verifies proofs minted before the ops claim without widening their authority', () => {
    const issuedAt = Math.floor(
      new Date('2026-10-12T04:00:00Z').getTime() / 1000
    );
    const payload = {
      aud: 'baci:cart-session',
      cartId: CART_ID,
      env: ENVIRONMENT,
      exp: issuedAt + 3600,
      grantId: GRANT_ID,
      iat: issuedAt,
      merchantId: MERCHANT_ID,
      principalId: PRINCIPAL_ID,
      scope: 'session',
      v: 'cp1',
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', SECRET)
      .update(`cp1.${encoded}`)
      .digest('base64url');
    const verified = verifyCartSessionProof(`cp1.${encoded}.${signature}`, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:01Z'),
      secret: SECRET,
    });

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      // A pre-ops proof may still identify the session for reads and
      // revocation, but it must not acquire mutations it never encoded.
      expect(verified.session.allowedOperations).toEqual([]);
    }
  });
});

describe('verifyCartSessionProof', () => {
  it('rejects a tampered payload', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });
    const [version, payload, signature] = proof.split('.');
    const tamperedPayload = `${payload.slice(0, -2)}AA`;
    const tampered = `${version}.${tamperedPayload}.${signature}`;

    const verified = verifyCartSessionProof(tampered, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('rejects a well-formed proof signed with the wrong secret', () => {
    const forged = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: 'attacker-controlled-secret-with-enough-length-1',
    });

    const verified = verifyCartSessionProof(forged, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('rejects a malformed proof without throwing', () => {
    const verified = verifyCartSessionProof('cp1 Zm9vYmFy.unknown', {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('rejects an expired proof', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    const verified = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-19T04:00:01Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'expired_proof', ok: false });
  });

  it('rejects a proof from another environment', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: 'production',
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    const verified = verifyCartSessionProof(proof, {
      environment: 'preview',
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'wrong_environment', ok: false });
  });

  it('rejects a proof for another audience', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      audience: 'baci:cart-session',
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    const verified = verifyCartSessionProof(proof, {
      audience: 'baci:other-service',
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'wrong_audience', ok: false });
  });

  it('accepts a previous secret during rotation and rejects it after removal', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    const duringRotation = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      previousSecrets: [SECRET],
      secret: ROTATED_SECRET,
    });
    expect(duringRotation.ok).toBe(true);

    const afterRemoval = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: ROTATED_SECRET,
    });
    expect(afterRemoval).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('never renews an expired proof into a valid one', () => {
    const expired = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-10T04:00:00Z'),
      secret: SECRET,
    });

    const verified = verifyCartSessionProof(expired, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'expired_proof', ok: false });
  });
});
it('includes replace in the session transport vocabulary while database grants remain authoritative', () => {
  const now = new Date('2026-10-12T04:00:00Z');
  const proof = issueCartSessionProof(sessionInput(), {
    environment: ENVIRONMENT,
    now,
    secret: SECRET,
  });
  const result = verifyCartSessionProof(proof, {
    environment: ENVIRONMENT,
    now,
    secret: SECRET,
  });
  expect(result.ok && result.session.allowedOperations).toContain('replace');
});
it('allows an expired signed proof only for revocation, preserving signature and environment checks', async () => {
  const { verifyCartSessionProofForRevocation } = await import(
    './session-proof'
  );
  const proof = issueCartSessionProof(sessionInput(), {
    environment: ENVIRONMENT,
    now: new Date('2026-10-12T00:00:00Z'),
    secret: SECRET,
  });
  const options = {
    environment: ENVIRONMENT,
    now: new Date('2026-10-19T00:01:00Z'),
    secret: SECRET,
  };
  expect(verifyCartSessionProof(proof, options).ok).toBe(false);
  expect(verifyCartSessionProofForRevocation(proof, options).ok).toBe(true);
  expect(
    verifyCartSessionProofForRevocation(`${proof}changed`, options).ok
  ).toBe(false);
  expect(
    verifyCartSessionProofForRevocation(proof, {
      ...options,
      environment: 'other',
    }).ok
  ).toBe(false);
});

it('rejects proofs issued in the future', () => {
  const proof = issueCartSessionProof(sessionInput(), {
    environment: ENVIRONMENT,
    now: new Date('2026-10-12T02:00:00Z'),
    secret: SECRET,
  });
  expect(
    verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T00:00:00Z'),
      secret: SECRET,
    })
  ).toEqual({ error: 'invalid_proof', ok: false });
});

it('rejects revocation once the proof expired beyond the grace window', async () => {
  const { verifyCartSessionProofForRevocation } = await import(
    './session-proof'
  );
  const proof = issueCartSessionProof(sessionInput(), {
    environment: ENVIRONMENT,
    now: new Date('2026-10-12T00:00:00Z'),
    secret: SECRET,
  });
  // Proof expired 2026-10-19; three days later it must no longer be
  // able to retire device access.
  expect(
    verifyCartSessionProofForRevocation(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-22T00:00:01Z'),
      secret: SECRET,
    })
  ).toEqual({ error: 'expired_proof', ok: false });
});

it('keeps an idle proof usable through the seven-day backing grant window', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  const proof = issueCartSessionProof(
    { ...sessionInput(), grantExpiresAt: '2026-10-22T00:00:00Z' },
    { secret: SECRET, environment: ENVIRONMENT, now }
  );
  expect(
    verifyCartSessionProof(proof, {
      secret: SECRET,
      environment: ENVIRONMENT,
      now: new Date('2026-10-17T00:00:00Z'),
    }).ok
  ).toBe(true);
});

it('uses configured previous keys across the runtime verifier during rotation', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  const proof = issueCartSessionProof(sessionInput(), {
    secret: SECRET,
    environment: ENVIRONMENT,
    now,
  });
  vi.stubEnv('CART_SESSION_SECRET', ROTATED_SECRET);
  vi.stubEnv('CART_SESSION_PREVIOUS_SECRETS', JSON.stringify([SECRET]));
  expect(
    verifyCartSessionProof(proof, { environment: ENVIRONMENT, now }).ok
  ).toBe(true);
  vi.stubEnv('CART_SESSION_PREVIOUS_SECRETS', '[]');
  expect(
    verifyCartSessionProof(proof, { environment: ENVIRONMENT, now })
  ).toMatchObject({ ok: false, error: 'invalid_proof' });
});

it('round-trips proofs from a long preview hostname and rejects another deployment', () => {
  vi.stubEnv('CART_PROOF_ENVIRONMENT', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_URL', `baci-${'long-branch'.repeat(12)}-one.vercel.app`);
  const now = new Date('2026-10-15T10:00:00Z');
  const proof = issueCartSessionProof(sessionInput(), {
    secret: SECRET,
    environment: getCartProofEnvironment(),
    now,
  });
  expect(
    verifyCartSessionProof(proof, {
      secret: SECRET,
      environment: getCartProofEnvironment(),
      now,
    }).ok
  ).toBe(true);
  vi.stubEnv('VERCEL_URL', `baci-${'long-branch'.repeat(12)}-two.vercel.app`);
  expect(
    verifyCartSessionProof(proof, {
      secret: SECRET,
      environment: getCartProofEnvironment(),
      now,
    })
  ).toEqual({ ok: false, error: 'wrong_environment' });
});
