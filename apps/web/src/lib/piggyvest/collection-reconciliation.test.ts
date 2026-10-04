import { expect, it, vi } from 'vitest';
import { createCollectionReconciliation } from './collection-reconciliation';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
it('records pending evidence through SQL without acknowledging a lost response', async () => {
  const execute = vi.fn().mockRejectedValue(new Error('private SQL password'));
  const fixture = scheduleStoreRuntimeFixture(101, execute);
  const config = fixture.options.configuration;
  const store = createCollectionReconciliation({
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      integrationId: config.integrationId,
      merchantId: config.merchantId,
      expectedBusinessId: config.expectedBusinessId,
      customerId: config.allowlistedCustomerIds[0],
      goalId: fixture.goalId,
      actorId: fixture.actorId,
    },
    execute,
  });
  const input = {
    operationId: fixture.actorId,
    observationId: fixture.goalId,
    collectionReference: 'synthetic-collection',
    evidenceId: 'synthetic-economic-credit',
    providerWalletId: 'synthetic-wallet',
    providerCustomerId: 'synthetic-customer',
    observation: 'pending',
  };
  expect(await store.observe(input)).toMatchObject({
    status: 'unconfirmed',
    operationId: input.operationId,
    observationId: input.observationId,
    readbackRequired: true,
    debitPermission: false,
  });
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(
    store.observe({ ...input, observation: 'synthetic_confirmed' })
  ).rejects.toThrow('Collection reconciliation unavailable');
  expect(execute).toHaveBeenCalledTimes(1);
  execute.mockResolvedValue({
    rows: [
      {
        result: {
          operationId: input.operationId,
          observationId: input.observationId,
          goalId: fixture.goalId,
          status: 'pending',
          financialEffects: 'UNKNOWN',
          dispatch: 'disabled',
          debitPermission: false,
        },
      },
    ],
  });
  expect(await store.observe(input)).toMatchObject({
    status: 'persisted_observation',
    receipt: { financialEffects: 'UNKNOWN', debitPermission: false },
  });
  execute.mockResolvedValue({
    rows: [
      {
        result: {
          operationId: input.observationId,
          observationId: input.observationId,
          goalId: fixture.goalId,
          status: 'pending',
          financialEffects: 'UNKNOWN',
          dispatch: 'disabled',
          debitPermission: false,
        },
      },
    ],
  });
  expect(await store.observe(input)).toMatchObject({ status: 'unconfirmed' });
  await expect(store.read({ operationId: input.operationId })).rejects.toThrow(
    'Collection reconciliation unavailable'
  );
  const snapshot = {
    operationId: input.operationId,
    goalId: fixture.goalId,
    current: { status: 'unknown', financialEffects: 'UNKNOWN' },
    historical: null,
    ledgerEvidence: null,
    ledger: {
      ledger: {
        confirmedPrincipalKobo: 100,
        reservedPrincipalKobo: 0,
        paidEligibleInterestKobo: 0,
        reservedPaidInterestKobo: 0,
        pendingInterestKobo: 0,
      },
      activeReservation: null,
      fundingReversed: false,
    },
  };
  execute.mockResolvedValue({ rows: [{ result: snapshot }] });
  expect(await store.read({ operationId: input.operationId })).toEqual(
    snapshot
  );
  execute.mockResolvedValue({
    rows: [{ result: { ...snapshot, goalId: input.operationId } }],
  });
  await expect(store.read({ operationId: input.operationId })).rejects.toThrow(
    'Collection reconciliation unavailable'
  );
});
