import { fetchWithCsrf } from '@/lib/api-client';
import {
  type OxygenRuntimeAction,
  oxygenRuntimeActionSchema,
  validateOxygenFile,
} from '@/schemas/oxygen-runtime';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export function canReplaceQueuedAddress(snapshot: OxygenRuntimeSnapshot) {
  return (
    snapshot.pending?.action === 'submit_address' &&
    snapshot.pending.status === 'queued' &&
    snapshot.stage === 'booked' &&
    Boolean(snapshot.state.bookingReference) &&
    snapshot.state.booking?.status === 'BOOKED' &&
    snapshot.state.kyc?.address_status === 'NOT_DONE'
  );
}
export async function retireQueuedAddress(
  snapshot: OxygenRuntimeSnapshot,
  command: OxygenRuntimeAction,
  file?: File
) {
  if (
    !file ||
    file.size === 0 ||
    file.size > 1_572_864 ||
    !oxygenRuntimeActionSchema.safeParse(command).success ||
    command.action !== 'submit_address' ||
    !canReplaceQueuedAddress(snapshot) ||
    !snapshot.pending ||
    !snapshot.state.bookingReference
  )
    throw new Error('Unable to continue');
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read document'));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(new Uint8Array(reader.result))
        : reject(new Error('Unable to read document'));
    reader.readAsArrayBuffer(file);
  });
  if (!validateOxygenFile(bytes, file.type, file.name))
    throw new Error('Choose a valid PDF, JPG or PNG document.');
  const response = await fetchWithCsrf(
    '/api/payments/oxygen/workflows/address-recovery',
    {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        workflowId: snapshot.workflowId,
        version: snapshot.version,
        idempotencyKey: snapshot.pending.idempotencyKey,
        bookingReference: snapshot.state.bookingReference,
      }),
    }
  );
  if (!response.ok || (await response.json()).retired !== true)
    throw new Error('Unable to continue');
}

export function selectOxygenActionKey(
  action: string,
  snapshot: OxygenRuntimeSnapshot,
  last: { action: string; version: number; key: string } | null,
  readRecovery: string | null
) {
  const pending = snapshot.pending;
  if (
    action === 'submit_address' &&
    pending?.action === action &&
    pending.status === 'queued'
  )
    return crypto.randomUUID();
  if (pending?.status === 'queued' && pending.action === action)
    return pending.idempotencyKey;
  if (
    !(pending?.status === 'executing' && readRecovery === action) &&
    !(
      action === 'validate_nin' && snapshot.ninAttemptStatus === 'safe_retry'
    ) &&
    last?.action === action &&
    last.version === snapshot.version
  )
    return last.key;
  return crypto.randomUUID();
}
