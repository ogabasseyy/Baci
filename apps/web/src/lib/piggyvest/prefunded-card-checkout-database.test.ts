import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardCheckoutDatabase } from './prefunded-card-checkout-database';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';

vi.mock('server-only', () => ({}));
const fixture = prefundedCardCheckoutFixture();
const reserved = {
  intent: fixture.intent,
  phase: 'reserved',
  session: null,
  operationId: null,
};
let timestamp: number;
const result = (value: unknown) => ({ rows: [{ result: value }] });
function setup() {
  const customerExecute = vi.fn().mockResolvedValue(result(reserved));
  const verifierExecute = vi.fn().mockResolvedValue(result(fixture.claim));
  const store = createPrefundedCardCheckoutDatabase({
    scope: fixture.scope,
    customerExecute,
    verifierExecute,
    now: () => timestamp,
  });
  return { store, customerExecute, verifierExecute };
}
beforeEach(() => {
  timestamp = Date.parse('2026-09-26T12:00:00Z');
});

describe('first-card restricted storage adapter', () => {
  it('uses the customer executor only for reservation and scoped read', async () => {
    const { store, customerExecute, verifierExecute } = setup();
    await store.reserve(fixture.scope, fixture.request);
    await store.read(fixture.scope, fixture.selection);
    expect(customerExecute).toHaveBeenNthCalledWith(
      1,
      statements.checkoutReserve.text,
      [JSON.stringify(fixture.scope), JSON.stringify(fixture.request)]
    );
    expect(customerExecute).toHaveBeenNthCalledWith(
      2,
      statements.checkoutRead.text,
      [JSON.stringify(fixture.scope), JSON.stringify(fixture.selection)]
    );
    expect(verifierExecute).not.toHaveBeenCalled();
  });

  it('uses only the verifier executor for initialization and collection promotion', async () => {
    const { store, customerExecute, verifierExecute } = setup();
    await store.claimInitialization(fixture.scope, fixture.selection);
    verifierExecute.mockResolvedValueOnce(
      result({ ...reserved, phase: 'ready', session: fixture.session })
    );
    await store.completeInitialization(
      fixture.scope,
      fixture.selection,
      fixture.claim,
      fixture.session
    );
    verifierExecute.mockResolvedValueOnce(
      result({
        ...reserved,
        phase: 'funding_pending',
        operationId: fixture.intent.intentId,
      })
    );
    await store.promoteVerifiedCollection(
      fixture.scope,
      fixture.selection,
      fixture.collection
    );
    expect(verifierExecute.mock.calls.map(([statement]) => statement)).toEqual([
      statements.checkoutClaim.text,
      statements.checkoutComplete.text,
      statements.checkoutPromote.text,
    ]);
    expect(customerExecute).not.toHaveBeenCalled();
  });

  it('refuses caller scope drift and mismatched intent evidence before SQL', async () => {
    const { store, customerExecute, verifierExecute } = setup();
    await expect(
      store.reserve(
        { ...fixture.scope, merchantId: fixture.scope.integrationId },
        fixture.request
      )
    ).rejects.toThrow('First-card storage unavailable');
    await expect(
      store.completeInitialization(
        fixture.scope,
        fixture.selection,
        {
          ...fixture.claim,
          intent: { ...fixture.intent, actorId: fixture.intent.customerId },
        },
        fixture.session
      )
    ).rejects.toThrow('First-card storage unavailable');
    await expect(
      store.promoteVerifiedCollection(fixture.scope, fixture.selection, {
        ...fixture.collection,
        intentId: fixture.intent.goalId,
      })
    ).rejects.toThrow('First-card storage unavailable');
    expect(customerExecute).not.toHaveBeenCalled();
    expect(verifierExecute).not.toHaveBeenCalled();
  });

  it('permits only fenced uncertainty cleanup after the fixed deadline', async () => {
    const { store, customerExecute, verifierExecute } = setup();
    timestamp = Date.parse(fixture.scope.expiresAt);
    await expect(store.reserve(fixture.scope, fixture.request)).rejects.toThrow(
      'First-card storage unavailable'
    );
    await expect(
      store.claimInitialization(fixture.scope, fixture.selection)
    ).rejects.toThrow('First-card storage unavailable');
    await expect(
      store.promoteVerifiedCollection(
        fixture.scope,
        fixture.selection,
        fixture.collection
      )
    ).rejects.toThrow('First-card storage unavailable');
    verifierExecute.mockResolvedValueOnce(result(true));
    await store.markInitializationUncertain(
      fixture.scope,
      fixture.selection,
      fixture.claim
    );
    expect(verifierExecute).toHaveBeenCalledExactlyOnceWith(
      statements.checkoutUncertain.text,
      [
        JSON.stringify(fixture.scope),
        JSON.stringify(fixture.selection),
        JSON.stringify(fixture.claim),
      ]
    );
    expect(customerExecute).not.toHaveBeenCalled();
  });

  it('requires acknowledgement and never returns raw SQL details', async () => {
    const { store, customerExecute, verifierExecute } = setup();
    customerExecute.mockRejectedValueOnce(new Error('sensitive-db-password'));
    await expect(store.read(fixture.scope, fixture.selection)).rejects.toThrow(
      'First-card storage unavailable'
    );
    verifierExecute.mockResolvedValueOnce(result(false));
    await expect(
      store.flagReconciliation(fixture.scope, fixture.selection)
    ).rejects.toThrow('First-card storage unavailable');
    verifierExecute.mockResolvedValueOnce({ rows: [] });
    await expect(
      store.claimInitialization(fixture.scope, fixture.selection)
    ).rejects.toThrow('First-card storage unavailable');
  });
});
