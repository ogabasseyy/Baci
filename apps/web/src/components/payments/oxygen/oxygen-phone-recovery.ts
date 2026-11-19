import { fetchWithCsrf } from '@/lib/api-client';

/** An explicit resend may retire only a still-queued verification. */
export async function retireQueuedPhoneVerification(
  workflowId: string,
  version: number,
  idempotencyKey: string
): Promise<void> {
  const response = await fetchWithCsrf(
    '/api/payments/oxygen/workflows/phone-recovery',
    {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ workflowId, version, idempotencyKey }),
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
