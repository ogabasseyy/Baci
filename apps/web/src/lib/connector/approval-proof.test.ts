import { describe, expect, it } from 'vitest';
import {
  type ApprovalIntent,
  canonicalizeEffect,
  effectDigestOf,
  verifyApprovalIntent,
} from '@/lib/connector/approval-proof';
import { CONNECTOR_POLICY_VERSION } from '@/lib/connector/authorize';

const EFFECT = {
  operation: 'orders.mark_shipped_existing',
  resource: { id: 'order-1', version: 9 },
  money: { wallet_reversal: 0, savings_reversal: 0, refund_amount: 0 },
  notify_customer: false,
};

function intent(overrides: Partial<ApprovalIntent> = {}): ApprovalIntent {
  return {
    approvalIntentId: 'intent-1',
    actorUserId: 'user-1',
    connectorGrantId: 'grant-1',
    operation: 'orders.mark_shipped_existing',
    resourceId: 'order-1',
    resourceVersion: 9,
    effectDigest: effectDigestOf(EFFECT),
    nonce: 'nonce-1',
    issuedAt: '2026-10-01T12:00:00.000Z',
    expiresAt: '2026-10-01T12:05:00.000Z',
    policyVersion: CONNECTOR_POLICY_VERSION,
    ...overrides,
  };
}

const NOW = new Date('2026-10-01T12:02:00.000Z');

describe('approval proof verification', () => {
  it('canonicalizes effects independent of key order', () => {
    expect(canonicalizeEffect({ b: 1, a: { d: 4, c: 3 } })).toBe(
      canonicalizeEffect({ a: { c: 3, d: 4 }, b: 1 })
    );
    expect(effectDigestOf(EFFECT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-JSON runtime values instead of coercing them', () => {
    for (const bad of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
      Symbol('x'),
    ]) {
      expect(() =>
        canonicalizeEffect(bad as unknown as Record<string, never>)
      ).toThrow('approval_effect_non_json_value');
    }
    expect(() => effectDigestOf(undefined as never)).toThrow(
      'approval_effect_non_json_value'
    );
  });

  it('rejects non-plain objects', () => {
    expect(() =>
      canonicalizeEffect(new Date() as unknown as Record<string, never>)
    ).toThrow('approval_effect_non_json_value');
    class Custom {
      a = 1;
    }
    expect(() =>
      canonicalizeEffect(new Custom() as unknown as Record<string, never>)
    ).toThrow('approval_effect_non_json_value');
    expect(canonicalizeEffect({ a: 1 })).toBe('{"a":1}');
  });

  it('rejects sparse arrays rather than hashing missing elements', () => {
    expect(() => canonicalizeEffect(new Array(1))).toThrow(
      'approval_effect_non_json_value'
    );
    expect(canonicalizeEffect([])).toBe('[]');
    expect(canonicalizeEffect([null])).toBe('[null]');
  });

  it('accepts an exact, unexpired, unconsumed execution', () => {
    const result = verifyApprovalIntent(intent(), {
      operation: 'orders.mark_shipped_existing',
      resourceId: 'order-1',
      resourceVersion: 9,
      effect: EFFECT,
      actorUserId: 'user-1',
      connectorGrantId: 'grant-1',
      nonceConsumed: false,
      approverAuthorized: true,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, nonce: 'nonce-1' });
  });

  it('rejects malformed approval windows', () => {
    for (const override of [
      { issuedAt: 'not-a-date' },
      { expiresAt: 'not-a-date' },
      {
        issuedAt: '2026-10-01T12:10:00.000Z',
        expiresAt: '2026-10-01T12:15:00.000Z',
      },
      {
        issuedAt: '2026-10-01T12:00:00.000Z',
        expiresAt: '2026-10-01T12:00:00.000Z',
      },
    ]) {
      const result = verifyApprovalIntent(intent(override), {
        operation: 'orders.mark_shipped_existing',
        resourceId: 'order-1',
        resourceVersion: 9,
        effect: EFFECT,
        actorUserId: 'user-1',
        connectorGrantId: 'grant-1',
        nonceConsumed: false,
        approverAuthorized: true,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.body.code).toBe('APPROVAL_EXPIRED');
      }
    }
  });

  it('expires approvals past their validity window', () => {
    const result = verifyApprovalIntent(intent(), {
      operation: 'orders.mark_shipped_existing',
      resourceId: 'order-1',
      resourceVersion: 9,
      effect: EFFECT,
      actorUserId: 'user-1',
      connectorGrantId: 'grant-1',
      nonceConsumed: false,
      approverAuthorized: true,
      now: new Date('2026-10-01T12:06:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('APPROVAL_EXPIRED');
    }
  });

  it('rejects replay with an already-consumed nonce', () => {
    const result = verifyApprovalIntent(intent(), {
      operation: 'orders.mark_shipped_existing',
      resourceId: 'order-1',
      resourceVersion: 9,
      effect: EFFECT,
      actorUserId: 'user-1',
      connectorGrantId: 'grant-1',
      nonceConsumed: true,
      approverAuthorized: true,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('APPROVAL_ALREADY_USED');
    }
  });

  it('expires approvals when effects, version, or operation drift', () => {
    const drifted = { ...EFFECT, notify_customer: true };
    for (const execution of [
      {
        operation: 'orders.mark_shipped_existing',
        resourceId: 'order-1',
        resourceVersion: 9,
        effect: drifted,
      },
      {
        operation: 'orders.mark_shipped_existing',
        resourceId: 'order-1',
        resourceVersion: 10,
        effect: EFFECT,
      },
      {
        operation: 'orders.mark_delivered',
        resourceId: 'order-1',
        resourceVersion: 9,
        effect: EFFECT,
      },
    ]) {
      const result = verifyApprovalIntent(intent(), {
        ...execution,
        actorUserId: 'user-1',
        connectorGrantId: 'grant-1',
        nonceConsumed: false,
        approverAuthorized: true,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.body.code).toBe('APPROVAL_EXPIRED');
      }
    }
  });

  it('rejects approvals presented under another grant or approver', () => {
    const result = verifyApprovalIntent(intent(), {
      operation: 'orders.mark_shipped_existing',
      resourceId: 'order-1',
      resourceVersion: 9,
      effect: EFFECT,
      actorUserId: 'user-1',
      connectorGrantId: 'grant-2',
      nonceConsumed: false,
      approverAuthorized: true,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('FORBIDDEN_SCOPE');
    }
  });

  it('denies execution when the approver lost permission', () => {
    const result = verifyApprovalIntent(intent(), {
      operation: 'orders.mark_shipped_existing',
      resourceId: 'order-1',
      resourceVersion: 9,
      effect: EFFECT,
      actorUserId: 'user-1',
      connectorGrantId: 'grant-1',
      nonceConsumed: false,
      approverAuthorized: false,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('ROLE_REMOVED');
    }
  });
});
