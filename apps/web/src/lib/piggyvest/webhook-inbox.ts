import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';

/**
 * Durable inbox for PiggyVest webhooks (Task 3).
 *
 * Money-flow rules enforced here:
 * - `recordEvent` inserts ON CONFLICT DO NOTHING: redeliveries collapse on
 *   `event_id`. Duplicate receipts still need a claim to recover crashed work.
 * - A duplicate whose stored envelope differs from the incoming one is a
 *   `conflict` (id reuse or replay corruption): the first writer wins and
 *   the conflicting observation goes to quarantine, never to the ledger.
 * - Claims use database-clock leases; completion is fenced by ownership.
 *   Ledger dedupe keys protect effects when an expired worker overlaps a retry.
 * - Only validated envelope fields are persisted — raw payloads (which carry
 *   bank account numbers/names) are never stored.
 * - `lastError` is truncated free text for operations; callers must pass
 *   sanitized summaries, never provider bodies.
 */

const recordInputSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  eventCategory: z.string().min(1),
  customerId: z.string().min(1),
  walletId: z.string().min(1).nullable().optional(),
  reference: z.string().min(1).nullable().optional(),
  amountKobo: z.int().nonnegative().nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RecordPiggyvestEventInput = z.input<typeof recordInputSchema>;

export type RecordPiggyvestEventOutcome = 'new' | 'duplicate' | 'conflict';

const MAX_DETAILS_BYTES = 8192;

const storedEnvelopeSchema = z.object({
  event_type: z.string(),
  event_category: z.string(),
  customer_id: z.string(),
  wallet_id: z.string().nullable(),
  reference: z.string().nullable(),
  amount_kobo: z.number().nullable(),
  event_details: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function recordPiggyvestEvent(
  supabase: PiggyvestIntakeServiceClient,
  input: RecordPiggyvestEventInput
): Promise<RecordPiggyvestEventOutcome> {
  // Brand is enforced at the boundary (only the intake edge constructs this
  // client); the query builder needs the plain client type for inference.
  const db: SupabaseClient = supabase;
  const parsed = recordInputSchema.parse(input);
  if (parsed.details) {
    const bytes = Buffer.byteLength(JSON.stringify(parsed.details), 'utf8');
    if (bytes > MAX_DETAILS_BYTES) {
      throw new Error('PiggyVest event details exceed size bound');
    }
  }
  const { data, error } = await db
    .from('piggyvest_webhook_inbox')
    .upsert(
      {
        event_id: parsed.eventId,
        event_type: parsed.eventType,
        event_category: parsed.eventCategory,
        customer_id: parsed.customerId,
        wallet_id: parsed.walletId ?? null,
        reference: parsed.reference ?? null,
        amount_kobo: parsed.amountKobo ?? null,
        event_details: parsed.details ?? null,
        status: 'pending',
      },
      { onConflict: 'event_id', ignoreDuplicates: true }
    )
    .select('event_id');

  if (error) {
    throw new Error(`Failed to record PiggyVest event: ${error.message}`);
  }
  if (data !== null && data.length > 0) return 'new';

  const existing = await db
    .from('piggyvest_webhook_inbox')
    .select(
      'event_type, event_category, customer_id, wallet_id, reference, amount_kobo, event_details'
    )
    .eq('event_id', parsed.eventId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `Failed to verify PiggyVest duplicate: ${existing.error.message}`
    );
  }
  if (!existing.data) {
    throw new Error('PiggyVest duplicate receipt vanished before verify');
  }
  const stored = storedEnvelopeSchema.safeParse(existing.data);
  if (!stored.success) {
    throw new Error('PiggyVest stored receipt is invalid');
  }
  const transactionId = parsed.details?.transaction_id;
  const transactionMatches =
    parsed.eventType !== 'bank-transfer.inflow.success' ||
    (typeof transactionId === 'string' &&
      transactionId.length > 0 &&
      stored.data.event_details?.transaction_id === transactionId);
  const matches =
    transactionMatches &&
    stored.data.event_type === parsed.eventType &&
    stored.data.event_category === parsed.eventCategory &&
    stored.data.customer_id === parsed.customerId &&
    stored.data.wallet_id === (parsed.walletId ?? null) &&
    stored.data.reference === (parsed.reference ?? null) &&
    stored.data.amount_kobo === (parsed.amountKobo ?? null);
  return matches ? 'duplicate' : 'conflict';
}

export async function claimPiggyvestEvent(
  supabase: SupabaseClient,
  eventId: string
): Promise<
  { outcome: 'claimed'; claimToken: string } | { outcome: 'busy' | 'processed' }
> {
  const id = z.string().min(1).parse(eventId);
  const { data, error } = await supabase.rpc('claim_piggyvest_webhook_event', {
    p_event_id: id,
  });

  if (error) {
    throw new Error(`Failed to claim PiggyVest event: ${error.message}`);
  }
  const result: unknown = data;
  if (typeof result !== 'object' || result === null || !('outcome' in result)) {
    throw new Error('Invalid PiggyVest claim response');
  }
  if (result.outcome === 'claimed') {
    if (!('claim_token' in result)) {
      throw new Error('Missing PiggyVest claim token');
    }
    return {
      outcome: 'claimed',
      claimToken: z.uuid().parse(result.claim_token),
    };
  }
  if (result.outcome === 'busy' || result.outcome === 'processed') {
    return { outcome: result.outcome };
  }
  throw new Error('Invalid PiggyVest claim outcome');
}

export async function resolvePiggyvestEvent(
  supabase: SupabaseClient,
  input: {
    eventId: string;
    claimToken: string;
    status: 'processed' | 'failed';
    lastError?: string;
  }
): Promise<void> {
  const parsed = z
    .object({
      eventId: z.string().min(1),
      claimToken: z.uuid(),
      status: z.enum(['processed', 'failed']),
      lastError: z.string().max(500).optional(),
    })
    .parse(input);
  const { data, error } = await supabase.rpc(
    'resolve_piggyvest_webhook_event',
    {
      p_event_id: parsed.eventId,
      p_claim_token: parsed.claimToken,
      p_status: parsed.status,
      p_last_error: parsed.lastError ?? null,
    }
  );

  if (error) {
    throw new Error(`Failed to resolve PiggyVest event: ${error.message}`);
  }
  if (data !== true) {
    throw new Error('PiggyVest event lease lost before resolution');
  }
}
