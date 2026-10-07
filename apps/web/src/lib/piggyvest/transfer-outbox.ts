import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';

/**
 * Outbox of our own PiggyVest transfer submissions.
 *
 * Money-flow rules enforced here:
 * - Our `reference` is the idempotency key: duplicate submissions collapse
 *   on it, and webhooks attribute to it. Money moves only on positive
 *   attribution — a terminal event for an unknown reference resolves
 *   without effect (the inbox keeps the audit trail).
 * - The first terminal state wins atomically: the flip updates only from
 *   'submitted', so a conflicting late arrival (success then failed, or
 *   vice versa) can never overwrite it.
 * - Destinations are stored masked (wallet id, or bank code + last4).
 *   Full destination account numbers are never persisted.
 */

export class TransferOutboxError extends Error {
  readonly code: 'TRANSFER_OUTBOX_STORAGE_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'TransferOutboxError';
    this.code = 'TRANSFER_OUTBOX_STORAGE_ERROR';
  }
}

const submissionSchema = z.object({
  reference: z.string().min(1).max(200),
  customerId: z.string().min(1),
  merchantId: z.string().min(1),
  walletId: z.string().min(1),
  amountKobo: z.int().positive(),
  direction: z.enum(['wallet', 'bank']),
  destinationRef: z.string().min(1).max(200),
});

export type RecordTransferSubmissionInput = z.input<typeof submissionSchema>;

export type RecordTransferSubmissionOutcome = 'recorded' | 'duplicate';

export async function recordTransferSubmission(
  supabase: SupabaseClient,
  input: RecordTransferSubmissionInput
): Promise<RecordTransferSubmissionOutcome> {
  const parsed = submissionSchema.parse(input);
  const { data, error } = await supabase
    .from('piggyvest_transfer_outbox')
    .upsert(
      {
        reference: parsed.reference,
        customer_id: parsed.customerId,
        merchant_id: parsed.merchantId,
        wallet_id: parsed.walletId,
        amount_kobo: parsed.amountKobo,
        direction: parsed.direction,
        destination_ref: parsed.destinationRef,
        status: 'submitted',
      },
      { onConflict: 'reference', ignoreDuplicates: true }
    )
    .select('reference');
  if (error) {
    throw new TransferOutboxError('Transfer submission record failed');
  }
  return data !== null && data.length > 0 ? 'recorded' : 'duplicate';
}

export type ApplyOutflowTerminalOutcome = 'matched' | 'unmatched';

const terminalStatusSchema = z.enum(['succeeded', 'failed']);

/**
 * Applies a terminal outflow state to the first attribution candidate that
 * matches a submitted row. Returns 'unmatched' when none of the candidates
 * was submitted by us — the caller resolves without effect.
 */
export async function applyOutflowTerminal(
  supabase: SupabaseClient,
  input: { references: string[]; status: 'succeeded' | 'failed' }
): Promise<ApplyOutflowTerminalOutcome> {
  const parsed = z
    .object({
      references: z.array(z.string().min(1)).min(1).max(10),
      status: terminalStatusSchema,
    })
    .parse(input);
  for (const reference of parsed.references) {
    const { data, error } = await supabase
      .from('piggyvest_transfer_outbox')
      .update({ status: parsed.status, updated_at: new Date().toISOString() })
      .eq('reference', reference)
      .eq('status', 'submitted')
      .select('reference');
    if (error) {
      throw new TransferOutboxError('Transfer status update failed');
    }
    if (data !== null && data.length > 0) {
      return 'matched';
    }
  }
  return 'unmatched';
}

/**
 * Reference candidates from an outflow event's unpublished eventData.
 * Order is most-specific first; matching stops at the first row we
 * actually submitted.
 */
export function outflowReferenceCandidates(
  eventData: Record<string, unknown>
): string[] {
  const candidates: string[] = [];
  for (const key of [
    'reference',
    'initiator_reference',
    'internal_reference',
    'third_party_reference',
  ]) {
    const value = eventData[key];
    if (typeof value === 'string' && value.length > 0) {
      candidates.push(value);
    }
  }
  return candidates;
}
