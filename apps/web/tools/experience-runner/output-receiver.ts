import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { TransientOutputStore } from './transient-output-store';

const schema = z.strictObject({
  jobId: z.string().min(1).max(100),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  attemptNonce: z.string().min(1).max(100),
  audience: z.literal('experience-output'),
  toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
  maxBytes: z.number().int().positive().max(16777216),
});
export type JobTicket = z.infer<typeof schema>;
const sign = (ticket: JobTicket, key: Uint8Array) =>
  createHmac('sha256', key).update(JSON.stringify(ticket)).digest('hex');
/** Ticket/signing key stay in trusted supervisor, never in sandbox input. */
export function signJobTicket(ticket: JobTicket, key: Uint8Array) {
  const parsed = schema.parse(ticket);
  if (key.length < 32) throw Error('INVALID_REQUEST');
  return { ticket: parsed, signature: sign(parsed, key) };
}
export async function acceptJobOutput(
  signed: { ticket: JobTicket; signature: string },
  output: unknown,
  deps: {
    key: Uint8Array;
    store: TransientOutputStore;
    now: () => number;
    currentAttempt: (job: string) => Promise<string>;
  }
) {
  const ticket = schema.parse(signed.ticket);
  const expected = Buffer.from(sign(ticket, deps.key), 'hex');
  const actual = Buffer.from(signed.signature, 'hex');
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected) ||
    ticket.expiresAt <= deps.now() ||
    Buffer.byteLength(JSON.stringify(output)) > ticket.maxBytes ||
    (await deps.currentAttempt(ticket.jobId)) !== ticket.attemptNonce
  )
    throw Error('INVALID_REQUEST');
  return deps.store.put(output, deps.now());
}
