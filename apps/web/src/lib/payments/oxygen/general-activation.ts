import 'server-only';
import { createCipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { OxygenRuntimeRpc } from './runtime-service';

/** A claim is a permanent fence: failures and interrupted requests are never replayed. */
export async function runGeneralOxygenActivation(
  worker: OxygenRuntimeRpc,
  workflowId: string,
  environment: 'staging' | 'production',
  enabled: boolean,
  request: (reference: string) => Promise<Response>,
  key: string
): Promise<void> {
  if (!enabled) return;
  z.uuid().parse(workflowId);
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Activation unavailable');
  const call = async (operation: string, payload: Record<string, unknown>) => {
    const result = await worker.rpc('oxygen_general_activation', {
      p_operation: operation,
      p_workflow_id: workflowId,
      p_payload: payload,
    });
    if (result.error) throw new Error('Activation unavailable');
    return result.data;
  };
  const value = await call('claim', {});
  if (value === null) return;
  const existing = z
    .object({
      status: z.enum(['activated', 'executing', 'indeterminate']),
      environment: z.literal(environment),
    })
    .safeParse(value);
  if (existing.success) {
    if (existing.data.status !== 'activated')
      throw new Error('Activation unconfirmed');
    await call('reconcile', {});
    return;
  }
  const claim = z
    .object({
      reference: z.uuid(),
      attemptId: z.uuid(),
      environment: z.literal(environment),
    })
    .parse(value);
  try {
    const response = await request(claim.reference);
    const reader = response.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 65536) {
            await reader.cancel();
            throw new Error('Response too large');
          }
          parts.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const body = Buffer.concat(parts).toString('utf8');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    cipher.setAAD(
      Buffer.from(`${workflowId}:${claim.attemptId}:${claim.reference}`)
    );
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({ status: response.status, body }), 'utf8'),
      cipher.final(),
    ]);
    const ciphertext = [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
    let status = 'indeterminate';
    try {
      const parsed = z
        .object({
          loan_reference: z.literal(claim.reference),
          status: z.literal('ACTIVATED'),
        })
        .safeParse(JSON.parse(body));
      if (response.ok && parsed.success) status = 'activated';
    } catch {
      /* Retain malformed responses as indeterminate evidence. */
    }
    await call('finish', {
      attemptId: claim.attemptId,
      reference: claim.reference,
      status,
      ciphertext,
    });
    if (status === 'activated') await call('reconcile', {});
    else throw new Error('Activation unconfirmed');
  } catch {
    // The provider may have received the request. Keep the durable claim in flight.
    throw new Error('Activation unconfirmed');
  }
}
