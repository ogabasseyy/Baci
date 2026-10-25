import 'server-only';
import { createCipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { oxygenActivationTrialStateSchema } from '@/schemas/oxygen-activation-trial';
import type { OxygenRuntimeRpc } from './runtime-service';
export const oxygenActivationTrialReference =
  '438f96ee-37c4-49bb-a56c-51451f9cb624';
export const oxygenActivationTrialWorkflow =
  'b1c11c04-ef5c-4519-963e-a5a9a8d2f951';
export type OxygenActivationTrialOperation = 'payment' | 'activate';
async function rpc(
  client: OxygenRuntimeRpc,
  operation: string,
  payload: Record<string, unknown> = {}
) {
  const response = await client.rpc('oxygen_activation_trial', {
    p_operation: operation,
    p_payload: payload,
  });
  if (response.error) throw new Error('Activation trial unavailable');
  return response.data;
}
export async function readOxygenActivationTrial(user: OxygenRuntimeRpc) {
  return oxygenActivationTrialStateSchema.parse(await rpc(user, 'status'));
}
/** Explicit one-booking staging trial. There is no automatic mutation retry. */
export async function runOxygenActivationTrial(
  user: OxygenRuntimeRpc,
  worker: OxygenRuntimeRpc,
  request: (operation: OxygenActivationTrialOperation) => Promise<Response>,
  key: string
) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Evidence unavailable');
  await rpc(user, 'enqueue');
  const claimed = await rpc(worker, 'claim');
  if (claimed === null) return;
  let mutationSent = false;
  let sequence = 0;
  async function observed(operation: OxygenActivationTrialOperation) {
    if (operation === 'activate') mutationSent = true;
    const response = await request(operation);
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
    const aad = Buffer.from(
      `${oxygenActivationTrialWorkflow}:${++sequence}:${operation}`
    );
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          operation,
          httpStatus: response.status,
          body,
          receivedAt: new Date().toISOString(),
        }),
        'utf8'
      ),
      cipher.final(),
    ]);
    await rpc(worker, 'evidence', {
      sequence,
      capture: {
        aad: aad.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: encrypted.toString('base64'),
      },
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('Invalid response');
    }
    if (!response.ok) {
      if (
        operation === 'activate' &&
        response.status >= 400 &&
        response.status < 500
      )
        mutationSent = false;
      throw new Error('Provider rejected request');
    }
    return parsed;
  }
  try {
    z.object({ reference: z.literal(oxygenActivationTrialReference) }).parse(
      claimed
    );
    const payment = z
      .object({
        split_payment: z.object({ completed: z.boolean() }),
        repayment_setup: z.object({ completed: z.boolean() }),
      })
      .parse(await observed('payment'));
    if (!payment.split_payment.completed || !payment.repayment_setup.completed)
      throw new Error('Payment incomplete');
    const shape = z.object({
      loan_reference: z.literal(oxygenActivationTrialReference),
      status: z.string(),
    });
    const raw = await observed('activate');
    const activated = shape.parse(raw);
    if (activated.status !== 'ACTIVATED')
      throw new Error('Activation not confirmed');
    const result: Record<string, unknown> = {
      loan_reference: activated.loan_reference,
      status: activated.status,
    };
    if (raw && typeof raw === 'object')
      for (const field of [
        'loan_amount',
        'product_amount',
        'equity_percentage',
        'equity_amount',
        'total_charges',
        'total_upfront_payment',
        'first_repayment',
        'loan_tenure',
      ] as const) {
        const value = (raw as Record<string, unknown>)[field];
        if (typeof value === 'number' && Number.isFinite(value))
          result[field] = value;
      }
    await rpc(worker, 'finish', { status: 'activated', result });
  } catch {
    await rpc(worker, 'finish', {
      status: mutationSent ? 'indeterminate' : 'rejected',
      result: {},
    });
  }
}
