import 'server-only';
import { z } from 'zod';
import {
  oxygenWorkflowCommandSchema,
  oxygenWorkflowStageSchema,
} from '@/schemas/oxygen-workflow';
import type { OxygenWorkflowWorkerStore } from './workflow';

/** Parameterized, private database connection authenticated as the dedicated
 * worker role. Never supply a user-facing Supabase client or service-role key. */
export interface OxygenWorkerSql {
  query(
    sql: string,
    values: readonly unknown[]
  ): Promise<{ rows: { result: unknown }[] }>;
}
const claimedSchema = z
  .object({
    id: z.uuid(),
    environment: z.enum(['staging', 'production']),
    stage: oxygenWorkflowStageSchema,
    command: oxygenWorkflowCommandSchema,
  })
  .strict();
export function createOxygenWorkflowWorkerStore(
  sql: OxygenWorkerSql,
  commandId: string
): OxygenWorkflowWorkerStore {
  z.uuid().parse(commandId);
  return {
    async claim() {
      const { rows } = await sql.query(
        'select oxygen_private.claim_command($1::uuid) as result',
        [commandId]
      );
      const result = rows[0]?.result;
      if (result === null) return null;
      // Malformed persisted work stays executing for investigation, never retried.
      return claimedSchema.parse(result);
    },
    async record(id, outcome, stage) {
      await sql.query(
        'select oxygen_private.record_command($1::uuid,$2::text,$3::text) as result',
        [id, outcome, stage]
      );
    },
  };
}
