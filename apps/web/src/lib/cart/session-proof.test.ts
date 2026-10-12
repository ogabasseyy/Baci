import { describe, expect, it } from 'vitest';
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  CART_SESSION_PROOF_TTL_SECONDS,
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
      now: new Date('2026-10-12T04:01:00Z'),
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
      ]);
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
      now: new Date('2026-10-12T04:01:00Z'),
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
      now: new Date('2026-10-12T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('rejects a malformed proof without throwing', () => {
    const verified = verifyCartSessionProof('cp1 Zm9vYmFy.unknown', {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:01:00Z'),
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
      now: new Date('2026-10-14T04:00:01Z'),
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
      now: new Date('2026-10-12T04:01:00Z'),
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
      now: new Date('2026-10-12T04:01:00Z'),
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
      now: new Date('2026-10-12T04:01:00Z'),
      previousSecrets: [SECRET],
      secret: ROTATED_SECRET,
    });
    expect(duringRotation.ok).toBe(true);

    const afterRemoval = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:01:00Z'),
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
      now: new Date('2026-10-12T04:01:00Z'),
      secret: SECRET,
    });

    expect(verified).toEqual({ error: 'expired_proof', ok: false });
  });
});
