import { vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardCheckoutRuntime } from './prefunded-card-checkout-runtime';

const fixture = prefundedCardCheckoutFixture();
const reserved = {
  intent: fixture.intent,
  phase: 'reserved',
  session: null,
  operationId: null,
};
const ready = { ...reserved, phase: 'ready', session: fixture.session };
const promoted = {
  ...reserved,
  phase: 'funding_pending',
  operationId: fixture.intent.intentId,
};

export function prefundedCardCheckoutRuntimeFixture(
  now: () => number = () => Date.parse('2026-09-26T12:00:00Z')
) {
  const store = {
    reserve: vi.fn().mockResolvedValue(reserved),
    read: vi.fn().mockResolvedValue(ready),
    claimInitialization: vi.fn().mockResolvedValue(fixture.claim),
    completeInitialization: vi.fn().mockResolvedValue(ready),
    markInitializationUncertain: vi.fn().mockResolvedValue(undefined),
    promoteVerifiedCollection: vi.fn().mockResolvedValue(promoted),
    flagReconciliation: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    initialize: vi.fn().mockResolvedValue(fixture.session),
    verify: vi.fn().mockResolvedValue({
      outcome: 'verified',
      collection: fixture.collection,
    }),
  };
  const resolveCustomer = vi.fn().mockResolvedValue(fixture.customerIdentity);
  const runtime = createPrefundedCardCheckoutRuntime({
    scope: fixture.scope,
    store,
    provider,
    resolveCustomer,
    now,
  });
  return {
    fixture,
    reserved,
    ready,
    promoted,
    store,
    provider,
    resolveCustomer,
    runtime,
  };
}
