import { describe, expect, it } from 'vitest';
import { verifyBuilderPublishIntent } from './approval';
import type { BuilderPublishExecution, BuilderPublishIntent } from './types';

const binding = {
  actorUserId: '10000000-0000-4000-8000-000000000001',
  connectionId: '20000000-0000-4000-8000-000000000001',
  grantVersion: 1,
  storefrontId: '30000000-0000-4000-8000-000000000001',
  draftVersion: '0001',
  destinationUrl: 'https://shop.usebaci.com',
  pageSlugs: ['home'] as const,
  policyNamespace: 'baci.website-builder' as const,
  policyVersion: 1,
  effectDigest: 'a'.repeat(64),
};
const intent: BuilderPublishIntent = {
  ...binding,
  intentId: '40000000-0000-4000-8000-000000000001',
  nonce: 'unguessable-one-use-nonce',
  issuedAt: '2026-10-21T10:00:00Z',
  expiresAt: '2026-10-21T10:10:00Z',
};
const execution: BuilderPublishExecution = {
  ...binding,
  nonceConsumed: false,
  approverAuthorized: true,
  now: new Date('2026-10-21T10:01:00Z'),
};
describe('builder-specific effect-bound approval', () => {
  it('accepts only the exact opaque revision and approved effect', () => {
    expect(verifyBuilderPublishIntent(intent, execution)).toEqual({
      ok: true,
      nonce: intent.nonce,
    });
    expect(
      verifyBuilderPublishIntent(intent, { ...execution, draftVersion: '1' })
    ).toEqual({ ok: false, code: 'APPROVAL_MISMATCH' });
    expect(
      verifyBuilderPublishIntent(intent, {
        ...execution,
        effectDigest: 'b'.repeat(64),
      }).ok
    ).toBe(false);
  });
  it('rejects Muse/cross-namespace approvals and mutated policy versions', () => {
    for (const patch of [
      { policyNamespace: 'baci.connector' },
      { policyVersion: 2 },
      { pageSlugs: ['about'] },
      { pageSlugs: ['home', 'home'] },
      { destinationUrl: 'https://attacker.invalid' },
    ])
      expect(
        verifyBuilderPublishIntent(
          { ...intent, ...patch } as BuilderPublishIntent,
          execution
        ).ok
      ).toBe(false);
  });
  it('rejects consumed, expired, malformed and future-issued intents', () => {
    expect(
      verifyBuilderPublishIntent(intent, { ...execution, nonceConsumed: true })
    ).toMatchObject({ ok: false, code: 'APPROVAL_ALREADY_USED' });
    for (const patch of [
      { expiresAt: '2026-10-21T10:01:00Z' },
      { expiresAt: 'invalid' },
      { issuedAt: '2026-10-21T11:00:00Z' },
      { expiresAt: '2026-10-21T11:00:00Z' },
    ])
      expect(
        verifyBuilderPublishIntent({ ...intent, ...patch }, execution)
      ).toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
  });
  it('rechecks current authority, canonical grant version and connection', () => {
    expect(
      verifyBuilderPublishIntent(intent, {
        ...execution,
        approverAuthorized: false,
      })
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT_SCOPE' });
    expect(
      verifyBuilderPublishIntent(intent, { ...execution, grantVersion: 2 })
    ).toMatchObject({ ok: false, code: 'CONNECTION_REVOKED' });
    expect(
      verifyBuilderPublishIntent(intent, {
        ...execution,
        connectionId: binding.actorUserId,
      }).ok
    ).toBe(false);
  });
});

it('rejects malformed page bindings without throwing and unsafe destinations', () => {
  for (const patch of [
    { pageSlugs: null },
    { actorUserId: '' },
    { connectionId: 'invalid' },
    { destinationUrl: 'javascript:alert(1)' },
  ]) {
    const current = { ...intent, ...patch } as unknown as BuilderPublishIntent;
    expect(() => verifyBuilderPublishIntent(current, execution)).not.toThrow();
    expect(verifyBuilderPublishIntent(current, execution).ok).toBe(false);
  }
});
