import { z } from 'zod';
import { fetchWithCsrf } from '@/lib/api-client';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';

/** Create or resume only the authenticated customer's order-bound workflow. */
export async function initializeOxygenWorkflow(
  orderId: string,
  decode: (response: Response) => Promise<unknown>
): Promise<string> {
  const response = await fetchWithCsrf('/api/payments/oxygen/workflows', {
    method: 'POST',
    body: JSON.stringify({ orderId, channel: 'web' }),
    cache: 'no-store',
  });
  return z
    .object({ workflow: z.object({ id: z.uuid() }) })
    .parse(await decode(response)).workflow.id;
}

export async function fetchOxygenSnapshot(
  id: string,
  decode: (response: Response) => Promise<unknown>
) {
  return oxygenRuntimeSnapshotSchema.parse(
    await decode(
      await fetchWithCsrf(
        `/api/payments/oxygen/workflows/actions?workflowId=${id}`,
        { cache: 'no-store' }
      )
    )
  );
}
