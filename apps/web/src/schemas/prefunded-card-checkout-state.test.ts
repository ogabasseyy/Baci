import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutFixture } from '@/lib/piggyvest/prefunded-card-checkout.test-fixture';
import { prefundedCardCheckoutStateSchemas as schemas } from './prefunded-card-checkout-state';

const fixture = prefundedCardCheckoutFixture();
const snapshot = {
  intent: fixture.intent,
  phase: 'reserved',
  session: null,
  operationId: null,
};

describe('first-card durable state contracts', () => {
  it('accepts reservation, recorded checkout and same-operation promotion', () => {
    expect(schemas.snapshot.safeParse(snapshot).success).toBe(true);
    expect(
      schemas.snapshot.safeParse({
        ...snapshot,
        phase: 'ready',
        session: fixture.session,
      }).success
    ).toBe(true);
    expect(
      schemas.snapshot.safeParse({
        ...snapshot,
        phase: 'funding_pending',
        operationId: fixture.intent.intentId,
      }).success
    ).toBe(true);
  });

  it('accepts an explicitly retired checkout without a payment operation', () => {
    expect(
      schemas.snapshot.safeParse({
        ...snapshot,
        phase: 'retired_unconfirmed',
      }).success
    ).toBe(true);
  });

  it('does not expose a checkout URL before durable initialization completes', () => {
    for (const phase of [
      'reserved',
      'initializing',
      'pending',
      'reconciliation_required',
    ]) {
      expect(
        schemas.snapshot.safeParse({
          ...snapshot,
          phase,
          session: fixture.session,
        }).success
      ).toBe(false);
    }
    expect(
      schemas.snapshot.safeParse({ ...snapshot, phase: 'ready' }).success
    ).toBe(false);
  });

  it('rejects a session for another reference or a replacement operation', () => {
    expect(
      schemas.snapshot.safeParse({
        ...snapshot,
        phase: 'ready',
        session: {
          ...fixture.session,
          reference: `pvb-first-${fixture.intent.goalId}`,
        },
      }).success
    ).toBe(false);
    expect(
      schemas.snapshot.safeParse({
        ...snapshot,
        phase: 'completed',
        operationId: fixture.intent.goalId,
      }).success
    ).toBe(false);
  });

  it('requires a fenced initialization claim and known verification outcome', () => {
    expect(schemas.initialization.safeParse(fixture.claim).success).toBe(true);
    expect(
      schemas.initialization.safeParse({ ...fixture.claim, fence: 0 }).success
    ).toBe(false);
    expect(
      schemas.verification.safeParse({
        outcome: 'verified',
        collection: fixture.collection,
      }).success
    ).toBe(true);
    expect(
      schemas.verification.safeParse({ outcome: 'paid_from_callback' }).success
    ).toBe(false);
  });
});
