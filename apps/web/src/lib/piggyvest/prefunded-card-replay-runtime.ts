import 'server-only';
import { prefundedCardReplayReadinessSchema } from '@/schemas/prefunded-card-replay-readiness';
import { prefundedCardReplayRuntimeSchema } from '@/schemas/prefunded-card-replay-runtime';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS } from './prefunded-card-postgres-statements';
import { createPrefundedCardReceiptReplay } from './prefunded-card-receipt-replay';
import { createPrefundedCardReplayEnrollment } from './prefunded-card-replay-enrollment';

export async function createPrefundedCardReplayRuntime(options: {
  configuration: unknown;
  expectedAppSystemId: string;
  fetchImplementation: typeof fetch;
}) {
  try {
    const { configuration, fetchImplementation } =
      prefundedCardReplayRuntimeSchema.parse(options);
    const { scope, evidence, database } = configuration;
    const workerExecute = createPrefundedCardPostgresExecutor(
      database.treasury
    );
    const ingestionExecute = createPrefundedCardPostgresExecutor(
      database.ingestion
    );
    for (const execute of [workerExecute, ingestionExecute]) {
      const result = await execute(
        PREFUNDED_CARD_POSTGRES_STATEMENTS.connectionReady.text,
        []
      );
      prefundedCardReplayReadinessSchema.parse(result.rows);
    }
    const enrollment = createPrefundedCardReplayEnrollment({
      configuration: { scope, databaseName: database.treasury.database },
      execute: workerExecute,
    });
    const replay = createPrefundedCardReceiptReplay({
      configuration: evidence,
      ingestionExecute,
      ledgerExecute: workerExecute,
      fetchImplementation,
    });
    return Object.freeze({
      async resolveEnrollment(input: Parameters<typeof enrollment>[0]) {
        try {
          return await enrollment(input);
        } catch {
          return 'deferred' as const;
        }
      },
      async replay(input: Parameters<typeof replay>[0]) {
        try {
          return await replay(input);
        } catch {
          throw new Error('Prefunded replay runtime unavailable');
        }
      },
    });
  } catch {
    throw new Error('Prefunded replay runtime unavailable');
  }
}
