import { fetchWithCsrf } from '@/lib/api-client';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export async function retireLegacyQueuedApproval(
  snapshot: OxygenRuntimeSnapshot
): Promise<void> {
  const { workflowId, version, pending } = snapshot;
  if (!pending) throw new Error('Unable to continue');
  const response = await fetchWithCsrf(
    '/api/payments/oxygen/workflows/legacy-approval-recovery',
    {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        workflowId,
        version,
        idempotencyKey: pending.idempotencyKey,
      }),
    }
  );
  if (!response.ok) throw new Error('Unable to continue');
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('retired' in body) ||
    body.retired !== true
  )
    throw new Error('Unable to continue');
}
