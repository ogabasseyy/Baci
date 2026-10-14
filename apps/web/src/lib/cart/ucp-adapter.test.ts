import { describe, expect, it } from 'vitest';

import {
  migratedCartRefreshOutcome,
  ucpCartCallerMismatch,
} from '@/lib/agentic/ucp-cart-storage';
import { UCP_PROFILE_VERSION } from '@/lib/agentic/ucp-profile-constants';

import fixture from './fixtures/ucp/cart-transfer-2026-04-08.json';
import {
  planUcpCartReplacement,
  platformWriteGate,
  ucpCartVersionPrecondition,
} from './ucp-adapter';

const productId = '33333333-3333-4333-8333-333333333333';

describe('UCP shared-cart adapter contracts (pinned fixtures)', () => {
  it('pins fixtures to the declared profile version', () => {
    expect(UCP_PROFILE_VERSION).toBe('2026-04-08');
    expect(fixture.profileVersion).toBe(UCP_PROFILE_VERSION);
    expect(fixture.cartResponseEnvelope.ucp.version).toBe(UCP_PROFILE_VERSION);
  });

  it('returns the refresh outcome only after a cart is shared', () => {
    expect(migratedCartRefreshOutcome({ migratedToCartId: null })).toBeNull();
    const outcome = migratedCartRefreshOutcome({
      migratedToCartId: 'canonical-1',
    });
    expect(outcome?.status).toBe(fixture.migratedCartOutcome.httpStatus);
    expect(outcome?.body.code).toBe(fixture.migratedCartOutcome.body.code);
    expect(outcome?.body.cart_id).toBe('canonical-1');
  });

  it('plans replacements through canonical cart validation', () => {
    const plan = planUcpCartReplacement({
      lines: [{ item: { productId }, quantity: 2 }],
      updatedAt: '2026-10-14T00:00:00.000Z',
    });
    expect(plan).toEqual({
      ok: true,
      command: {
        type: 'replace',
        lines: [{ item: { productId }, quantity: 2 }],
      },
      precondition: '2026-10-14T00:00:00.000Z',
    });
    const tooMany = planUcpCartReplacement({
      lines: Array.from({ length: 21 }, (_, index) => ({
        item: {
          productId: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
        },
        quantity: 1,
      })),
      updatedAt: '2026-10-14T00:00:00.000Z',
    });
    expect(tooMany.ok).toBe(false);
  });

  it('derives a version precondition that detects concurrent replacement', () => {
    expect(
      ucpCartVersionPrecondition({ updated_at: '2026-10-14T00:00:00.000Z' })
    ).toBe('2026-10-14T00:00:00.000Z');
    expect(
      ucpCartVersionPrecondition({ updated_at: '2026-10-14T00:00:00.000Z' })
    ).not.toBe(
      ucpCartVersionPrecondition({ updated_at: '2026-10-14T00:01:00.000Z' })
    );
  });

  it('scopes a platform cart to its recorded caller until handoff', () => {
    expect(ucpCartCallerMismatch({ agent_id: 'agent-a' }, 'agent-a')).toBe(
      false
    );
    expect(ucpCartCallerMismatch({ agent_id: 'agent-a' }, 'agent-b')).toBe(
      true
    );
    // Legacy rows without a recorded caller remain compatible.
    expect(ucpCartCallerMismatch({ agent_id: null }, 'agent-b')).toBe(false);
  });
});

it('hides a caller-owned cart when the signed request omits its caller identity', () => {
  expect(
    platformWriteGate({ cartAgentId: 'agent-a', callerAgentId: null })
  ).toEqual({ allowed: false, status: 404, body: { error: 'Cart not found' } });
});
