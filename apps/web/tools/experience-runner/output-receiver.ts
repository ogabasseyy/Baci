import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  experienceJobTicket,
  type JobTicket,
} from '../../src/schemas/experience-runner-proofs';

export type { JobTicket } from '../../src/schemas/experience-runner-proofs';

import type { TransientOutputStore } from './transient-output-store';

const sign = (ticket: JobTicket, key: Uint8Array) =>
  createHmac('sha256', key).update(JSON.stringify(ticket)).digest('hex');
/** Ticket/signing key stay in trusted supervisor, never in sandbox input. */
export function signJobTicket(ticket: JobTicket, key: Uint8Array) {
  const parsed = experienceJobTicket.parse(ticket);
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
  const ticket = experienceJobTicket.parse(signed.ticket);
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
