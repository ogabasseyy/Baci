import 'server-only';
import { piggyvestInboxEnqueueSchemas } from '@/schemas/piggyvest-inbox-enqueue';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import type { PiggyvestWebhookInbox } from './webhook-inbox.types';

type CommittedSqlExecutor = (
  statement: string,
  parameters: readonly unknown[]
) => Promise<{ rows: unknown[] }>;

export function createPiggyvestPostgresInbox({
  integrationId,
  execute,
}: {
  integrationId: unknown;
  execute: CommittedSqlExecutor;
}): PiggyvestWebhookInbox {
  const identity =
    piggyvestInboxEnqueueSchemas.integrationId.safeParse(integrationId);
  if (!identity.success) throw new Error('PiggyVest inbox unavailable');

  return {
    async enqueue(input) {
      try {
        const parsed = piggyvestInboxEnqueueSchemas.input.safeParse(input);
        if (!parsed.success || parsed.data.integrationId !== identity.data) {
          throw new Error('PiggyVest inbox unavailable');
        }
        const response = await execute(
          PIGGYVEST_POSTGRES_STATEMENTS.enqueueInbox.text,
          [
            identity.data,
            parsed.data.eventId,
            Buffer.from(parsed.data.rawPayload),
          ]
        );
        const rows = piggyvestInboxEnqueueSchemas.response.safeParse(
          response.rows
        );
        if (!rows.success) throw new Error('PiggyVest inbox unavailable');
        return rows.data[0].outcome;
      } catch {
        throw new Error('PiggyVest inbox unavailable');
      }
    },
  };
}
