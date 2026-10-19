import { createFinancialReplayPostgres } from './replay-financial-postgres';
import { checkFinancialReplayReadiness } from './replay-financial-readiness';
import { createInterestReplay } from './replay-interest-runtime';
import type { ReplayAdapters } from './replay-worker';
import { replayPaidInterestSchemas } from './schemas/replay-paid-interest';

export async function createPaidInterestReplay(input: {
  database: unknown;
  expectedAppSystemId: string;
}): Promise<NonNullable<ReplayAdapters['dispatchFinancial']>> {
  try {
    const database = replayPaidInterestSchemas.database.parse(input.database);
    const scope = replayPaidInterestSchemas.scope.parse({
      integrationId: database.integrationId,
      businessId: database.businessId,
      expectedSystemId: input.expectedAppSystemId,
    });
    if (
      (await checkFinancialReplayReadiness(
        database,
        scope.expectedSystemId
      )) !== 'ready'
    )
      throw new Error('Interest readiness refused');
    const replay = createInterestReplay(
      scope,
      createFinancialReplayPostgres(database)
    );
    return ({ event }) => {
      if (event.eventType !== 'interest-payout.success')
        throw new Error('Financial replay deferred');
      return replay(event);
    };
  } catch {
    throw new Error('Staging paid interest unavailable');
  }
}
