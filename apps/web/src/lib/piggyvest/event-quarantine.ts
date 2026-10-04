import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import z from 'zod';

/**
 * Durable quarantine for authentic deliveries that must never touch
 * financial state (unparseable bodies, unknown event shapes,
 * same-identity conflicts).
 *
 * Money-flow rules enforced here:
 * - A quarantine row is a receipt: callers acknowledge (2xx) only after it
 *   exists, so retries cannot fix — and must not burn attempts on — these
 *   events.
 * - Identical redeliveries collapse on the body digest.
 * - Detail is redacted JSON only, size-bounded. Raw bodies (which carry
 *   bank account numbers/names) are never stored.
 */

const MAX_DETAIL_BYTES = 8192;

const reasonSchema = z.enum(['unparseable', 'unknown-event', 'conflict']);

const recordInputSchema = z.object({
  bodyDigest: z.string().regex(/^[0-9a-f]{64}$/),
  reason: reasonSchema,
  eventId: z.string().min(1).max(200).nullable().optional(),
  eventType: z.string().min(1).max(200).nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RecordQuarantineEventInput = z.input<typeof recordInputSchema>;

export type RecordQuarantineEventOutcome = 'recorded' | 'duplicate';

export function digestRawBody(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export async function recordQuarantineEvent(
  supabase: PiggyvestIntakeServiceClient,
  input: RecordQuarantineEventInput
): Promise<RecordQuarantineEventOutcome> {
  // Brand is enforced at the boundary (only the intake edge constructs this
  // client); the query builder needs the plain client type for inference.
  const db: SupabaseClient = supabase;
  const parsed = recordInputSchema.parse(input);
  if (parsed.detail) {
    const bytes = Buffer.byteLength(JSON.stringify(parsed.detail), 'utf8');
    if (bytes > MAX_DETAIL_BYTES) {
      throw new Error('Quarantine detail exceeds size bound');
    }
  }
  const { data, error } = await db
    .from('piggyvest_event_quarantine')
    .upsert(
      {
        event_id: parsed.eventId ?? null,
        event_type: parsed.eventType ?? null,
        body_digest: parsed.bodyDigest,
        reason: parsed.reason,
        detail: parsed.detail ?? null,
      },
      { onConflict: 'body_digest', ignoreDuplicates: true }
    )
    .select('body_digest');

  if (error) {
    throw new Error(`Quarantine record failed: ${error.message}`);
  }
  return data !== null && data.length > 0 ? 'recorded' : 'duplicate';
}

const resolveInputSchema = z.object({
  bodyDigest: z.string().regex(/^[0-9a-f]{64}$/),
  resolution: z.string().min(1).max(500),
});

export async function resolveQuarantineEvent(
  supabase: SupabaseClient,
  input: { bodyDigest: string; resolution: string }
): Promise<void> {
  const parsed = resolveInputSchema.parse(input);
  const { error } = await supabase
    .from('piggyvest_event_quarantine')
    .update({
      resolved_at: new Date().toISOString(),
      resolution: parsed.resolution,
    })
    .eq('body_digest', parsed.bodyDigest)
    .select('body_digest');
  if (error) {
    throw new Error(`Quarantine resolve failed: ${error.message}`);
  }
}
