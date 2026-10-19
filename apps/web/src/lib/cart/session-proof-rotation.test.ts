import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCartProofEnvironment } from './cart-runtime-env';

afterEach(() => vi.unstubAllEnvs());

import { issueCartSessionProof, verifyCartSessionProof } from './session-proof';

const SECRET = ['test-cart-session-secret', 'with-enough-length-001'].join('-');
const ROTATED_SECRET = [
  'test-cart-session-secret',
  'with-enough-length-002',
].join('-');
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

describe('verifyCartSessionProof rotation', () => {
  it('accepts a previous secret during rotation and rejects it after removal', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    // Retired acceptance is a short 24-hour grace: one hour after
    // retirement the previous secret still verifies, forcing
    // re-bootstrap within a day rather than a full proof lifetime.
    const duringRotation = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-13T05:01:00Z'),
      previousSecrets: [{ retireAt: '2026-10-13T04:00:00Z', secret: SECRET }],
      secret: ROTATED_SECRET,
    });
    expect(duringRotation.ok).toBe(true);

    const afterRemoval = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-13T05:01:00Z'),
      secret: ROTATED_SECRET,
    });
    expect(afterRemoval).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('rejects a retired secret after its bounded rotation window', () => {
    const proof = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-12T04:00:00Z'),
      secret: SECRET,
    });

    // The key retired on 2026-10-13; one maximum proof lifetime later
    // (2026-10-20) no proof it signed may verify, even a fresh-dated one.
    const afterWindow = verifyCartSessionProof(proof, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-21T04:01:00Z'),
      previousSecrets: [{ retireAt: '2026-10-13T04:00:00Z', secret: SECRET }],
      secret: ROTATED_SECRET,
    });
    expect(afterWindow).toEqual({ error: 'invalid_proof', ok: false });

    // A proof claiming issuance after the key retired is likewise not
    // attributable to that key.
    const forged = issueCartSessionProof(sessionInput(), {
      environment: ENVIRONMENT,
      now: new Date('2026-10-14T04:00:00Z'),
      secret: SECRET,
    });
    const afterRetirement = verifyCartSessionProof(forged, {
      environment: ENVIRONMENT,
      now: new Date('2026-10-15T04:01:00Z'),
      previousSecrets: [{ retireAt: '2026-10-13T04:00:00Z', secret: SECRET }],
      secret: ROTATED_SECRET,
    });
    expect(afterRetirement).toEqual({ error: 'invalid_proof', ok: false });
  });
});

it('uses configured previous keys across the runtime verifier during rotation', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  const proof = issueCartSessionProof(sessionInput(), {
    secret: SECRET,
    environment: ENVIRONMENT,
    now,
  });
  vi.stubEnv('CART_SESSION_SECRET', ROTATED_SECRET);
  vi.stubEnv(
    'CART_SESSION_PREVIOUS_SECRETS',
    JSON.stringify([{ retireAt: '2026-10-16T00:00:00Z', secret: SECRET }])
  );
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
