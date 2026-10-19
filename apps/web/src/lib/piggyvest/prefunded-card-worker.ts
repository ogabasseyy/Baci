import 'server-only';
import { prefundedCardWorkerSchemas as schemas } from '@/schemas/prefunded-card-worker';
import type { createPrefundedCardRuntime } from './prefunded-card-runtime';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPrefundedCardWorker(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
  run: ReturnType<typeof createPrefundedCardRuntime>;
}) {
  const config = schemas.scope.parse(options.configuration);
  return async (signal?: AbortSignal) => {
    const totals = { claimed: 0, processed: 0, failed: 0, unacknowledged: 0 };
    if (signal?.aborted) return totals;
    const response = await options.execute(
      'SELECT prefunded_card.claim_due($1::uuid,$2::text,$3::text,$4::integer,$5::uuid,$6::uuid) AS result',
      [
        config.integrationId,
        config.businessId,
        config.expectedSystemId,
        config.batchSize.toString(),
        config.merchantId,
        config.treasuryBindingId,
      ]
    );
    const claims = schemas.claims.parse(response.rows)[0].result;
    if (
      claims.length > config.batchSize ||
      new Set(claims.map((claim) => claim.operationId)).size !== claims.length
    )
      throw new Error('Prefunded worker claims unavailable');
    totals.claimed = claims.length;
    for (const claim of claims) {
      if (signal?.aborted) break;
      try {
        await options.run(claim.operationId);
        totals.processed++;
      } catch {
        totals.failed++;
      }
      try {
        const completed = await options.execute(
          'SELECT prefunded_card.finish_dispatch($1::uuid,$2::uuid,$3::text) AS result',
          [claim.operationId, claim.token, config.expectedSystemId]
        );
        if (!schemas.acknowledgement.parse(completed.rows)[0].result)
          totals.unacknowledged++;
      } catch {
        totals.unacknowledged++;
      }
    }
    return totals;
  };
}
