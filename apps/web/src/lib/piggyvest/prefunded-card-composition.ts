import 'server-only';
import { prefundedCardCompositionSchema } from '@/schemas/prefunded-card-composition';
import { createPrefundedCardAuthorizationResolver } from './prefunded-card-authorization-resolver';
import { PREFUNDED_CARD_CUSTOMER_STATEMENTS } from './prefunded-card-customer-statements';
import { createPrefundedCardExecution } from './prefunded-card-execution';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { createPrefundedCardReceiptReplay } from './prefunded-card-receipt-replay';
import { createPrefundedCardReplayEnrollment } from './prefunded-card-replay-enrollment';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

function redacted<Arguments extends unknown[], Result>(
  operation: (...args: Arguments) => Promise<Result>
) {
  return async (...args: Arguments): Promise<Result> => {
    try {
      return await operation(...args);
    } catch {
      throw new Error('Prefunded composition unavailable');
    }
  };
}

export function createPrefundedCardComposition(options: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
}) {
  try {
    const configuration = prefundedCardCompositionSchema.parse(
      options.configuration
    );
    const fetchImplementation = options.fetchImplementation;
    if (typeof fetchImplementation !== 'function')
      throw new Error('Prefunded composition unavailable');
    const { database, worker, provider, evidence } = configuration;
    const workerExecute = createPrefundedCardPostgresExecutor(
      database.treasury
    );
    const ingestionExecute = createPrefundedCardPostgresExecutor(
      database.ingestion
    );
    const authorizerExecute = createPrefundedCardPostgresExecutor(
      database.authorizer
    );
    const customerExecute = createPrefundedCardPostgresExecutor({
      ...database.treasury,
      profile: 'customer',
    });
    const executeCustomer: PiggyvestProvisioningExecutor = redacted(
      async (statement: string, parameters: readonly unknown[]) => {
        if (
          (statement !== PREFUNDED_CARD_CUSTOMER_STATEMENTS.capabilities &&
            statement !== PREFUNDED_CARD_CUSTOMER_STATEMENTS.request &&
            statement !== PREFUNDED_CARD_CUSTOMER_STATEMENTS.status) ||
          parameters.length !== 8 ||
          parameters[0] !== worker.integrationId ||
          parameters[1] !== worker.merchantId ||
          parameters[5] !== worker.businessId ||
          parameters[6] !== worker.expectedSystemId
        )
          throw new Error('Prefunded composition unavailable');
        return await customerExecute(statement, parameters);
      }
    );
    const tick = createPrefundedCardExecution({
      worker,
      provider,
      evidence,
      execute: workerExecute,
      evidenceExecute: workerExecute,
      fetchImplementation,
    });
    const replayReceipt = createPrefundedCardReceiptReplay({
      configuration: evidence,
      ingestionExecute,
      ledgerExecute: workerExecute,
      fetchImplementation,
    });
    const resolveEnrollment = createPrefundedCardReplayEnrollment({
      configuration: {
        scope: {
          environment: worker.environment,
          integrationId: worker.integrationId,
          merchantId: worker.merchantId,
          treasuryBindingId: worker.treasuryBindingId,
          businessId: worker.businessId,
          expectedSystemId: worker.expectedSystemId,
        },
        databaseName: database.treasury.database,
      },
      execute: workerExecute,
    });
    const authorizer = createPrefundedCardAuthorizationResolver({
      execute: authorizerExecute,
      scope: {
        integrationId: worker.integrationId,
        merchantId: worker.merchantId,
        treasuryBindingId: worker.treasuryBindingId,
        systemIdentifier: worker.expectedSystemId,
      },
      verification: {
        paystackSecret: provider.paystackSecret,
        fetchImplementation,
      },
    });
    return Object.freeze({
      tick: redacted(tick),
      replayReceipt: redacted(replayReceipt),
      resolveEnrollment,
      customer: Object.freeze({
        enabled: true as const,
        expectedSystemId: worker.expectedSystemId,
        execute: executeCustomer,
      }),
      authorizer: Object.freeze({ provision: redacted(authorizer.provision) }),
    });
  } catch {
    throw new Error('Prefunded composition unavailable');
  }
}
