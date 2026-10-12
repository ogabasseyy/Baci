import 'server-only';
import { piggyvestInboxWorkerSchemas } from '@/schemas/piggyvest-inbox-worker';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';

type BatchResult =
  | { status: 'unavailable' }
  | {
      status: 'complete';
      claimed: number;
      quarantined: number;
      stale: number;
      failed: number;
    };

export async function quarantinePiggyvestInboxBatch({
  configuration,
  execute,
}: {
  configuration: unknown;
  execute: (
    statement: string,
    parameters: readonly unknown[]
  ) => Promise<{ rows: unknown[] }>;
}): Promise<BatchResult> {
  const config =
    piggyvestInboxWorkerSchemas.configuration.safeParse(configuration);
  if (!config.success) return { status: 'unavailable' };
  try {
    const response = await execute(
      PIGGYVEST_POSTGRES_STATEMENTS.claimInbox.text,
      [
        config.data.integrationId,
        config.data.batchSize,
        config.data.leaseSeconds,
      ]
    );
    const claims = piggyvestInboxWorkerSchemas.claims.safeParse(response.rows);
    if (!claims.success || claims.data.length > config.data.batchSize) {
      return { status: 'unavailable' };
    }
    const result = {
      status: 'complete' as const,
      claimed: claims.data.length,
      quarantined: 0,
      stale: 0,
      failed: 0,
    };
    for (const claim of claims.data) {
      try {
        const finished = await execute(
          PIGGYVEST_POSTGRES_STATEMENTS.quarantineInbox.text,
          [config.data.integrationId, claim.inbox_id, claim.claim_token]
        );
        const parsed = piggyvestInboxWorkerSchemas.finish.safeParse(
          finished.rows
        );
        if (!parsed.success) result.failed += 1;
        else if (parsed.data[0].outcome === 'quarantined')
          result.quarantined += 1;
        else result.stale += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  } catch {
    return { status: 'unavailable' };
  }
}
