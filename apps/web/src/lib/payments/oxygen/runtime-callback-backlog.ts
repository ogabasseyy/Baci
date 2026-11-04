import 'server-only';
import { z } from 'zod';
import type { OxygenRuntimeRpc } from './runtime-service';

const backlogSchema = z
  .object({
    pendingCount: z.number().int().min(0).max(1000),
    capped: z.boolean(),
    oldestAgeSeconds: z.number().int().nonnegative().nullable(),
  })
  .refine(
    (value) => (value.pendingCount === 0) === (value.oldestAgeSeconds === null)
  );

/** Aggregate only; no callback contents or customer identifiers leave the worker. */
export async function readOxygenCallbackBacklog(
  worker: OxygenRuntimeRpc,
  partner: string
) {
  const result = await worker.rpc('oxygen_callback', {
    p_operation: 'backlog',
    p_partner: partner,
    p_payload: {},
  });
  if (result.error) throw new Error('Callback backlog unavailable');
  return backlogSchema.parse(result.data);
}
