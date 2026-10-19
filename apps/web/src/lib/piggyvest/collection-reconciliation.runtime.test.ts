import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollectionReconciliation } from './collection-reconciliation';
import { COLLECTION_RECONCILIATION_STATEMENTS as statements } from './collection-reconciliation-statements';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
const enabled = process.env.PIGGYVEST_COLLECTION_EXECUTOR_ACCEPTANCE === '1';
const restarted = process.env.PIGGYVEST_COLLECTION_AFTER_RESTART === '1';
const command = {
  operationId: 'a2000000-0000-4000-8000-000000000501',
  observationId: 'b2000000-0000-4000-8888-000000000501',
  collectionReference: 'collection-501',
  evidenceId: 'incoming-501',
  providerWalletId: 'wallet-501',
  providerCustomerId: 'synthetic-customer',
  observation: 'unknown',
};
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const source = scheduleStoreRuntimeFixture(501);
  const config = source.options.configuration;
  const create = () =>
    createCollectionReconciliation({
      configuration: {
        environment: 'staging',
        transport: 'local_test',
        integrationId: config.integrationId,
        merchantId: config.merchantId,
        customerId: config.allowlistedCustomerIds[0],
        goalId: source.goalId,
        expectedBusinessId: config.expectedBusinessId,
        actorId: source.actorId,
      },
      execute: source.execute,
    });
  vi.stubGlobal('fetch', () => {
    throw new Error('External HTTP prohibited');
  });
  return { ...source, create };
}
describe.skipIf(!enabled)(
  'standard restricted executor metadata reconciliation',
  () => {
    it.skipIf(restarted)(
      'recovers a lost metadata acknowledgement without applying financial effects',
      async () => {
        const test = fixture();
        test.execute.mockImplementation(async (statement, parameters) => {
          const result = await test.database(statement, parameters);
          if (statement === statements.observeCollectionReconciliation.text)
            throw new Error('Synthetic lost metadata acknowledgement');
          return result;
        });
        expect(await test.create().observe(command)).toMatchObject({
          status: 'unconfirmed',
          operationId: command.operationId,
          observationId: command.observationId,
          readbackRequired: true,
        });
        const snapshot = await test.create().read({
          operationId: command.operationId,
          observationId: command.observationId,
        });
        expect(snapshot.current).toEqual({
          status: 'unknown',
          financialEffects: 'UNKNOWN',
        });
        expect(snapshot.historical).toMatchObject({
          status: 'unknown',
          financialEffects: 'UNKNOWN',
          debitPermission: false,
        });
        expect(snapshot.ledgerEvidence).toEqual({
          operationId: 'c2000000-0000-4000-8000-000000000501',
          principalKobo: 50,
          evidence: 'internal_ledger_only',
          fundsUse: 'not_authorized',
        });
        test.execute.mockImplementation(test.database);
        expect(await test.create().observe(command)).toEqual({
          status: 'persisted_observation',
          receipt: snapshot.historical,
        });
        expect(
          (await test.create().read({ operationId: command.operationId }))
            .ledger.ledger.confirmedPrincipalKobo
        ).toBe(150);
        expect(
          test.execute.mock.calls.every(
            ([statement]) => !statement.includes('.apply(')
          )
        ).toBe(true);
      }
    );
    it.skipIf(!restarted)(
      'reads metadata and distinct canonical evidence after restart without resolution authority',
      async () => {
        const test = fixture();
        const snapshot = await test.create().read({
          operationId: command.operationId,
          observationId: command.observationId,
        });
        expect(snapshot.current).toEqual({
          status: 'unknown',
          financialEffects: 'UNKNOWN',
        });
        expect(snapshot.historical).toMatchObject({
          observationId: command.observationId,
          debitPermission: false,
        });
        expect(snapshot.ledger.ledger.confirmedPrincipalKobo).toBe(150);
        expect(snapshot.ledgerEvidence?.fundsUse).toBe('not_authorized');
        expect(test.execute).toHaveBeenCalledTimes(1);
      }
    );
  }
);
