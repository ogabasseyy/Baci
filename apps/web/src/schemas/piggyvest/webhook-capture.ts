import z from 'zod';
import { piggyvestWebhookKeyFamilySchema } from './webhook-key-archive';

/**
 * Wire shapes of the durable webhook capture functions
 * (supabase/migrations/20261030231000_piggyvest_webhook_durable_capture.sql).
 * The database is the authority; these schemas only refuse to act on a
 * response that does not look like it.
 */
export const piggyvestCaptureProcessingStateSchema = z.enum([
  'pending',
  'claimed',
  'processed',
  'needs_review',
]);

export const piggyvestCaptureResultSchema = z.object({
  outcome: z.enum(['captured', 'duplicate']),
  id: z.uuid(),
  processingState: piggyvestCaptureProcessingStateSchema,
});

export type PiggyvestCaptureResult = z.infer<
  typeof piggyvestCaptureResultSchema
>;

export const piggyvestClaimedCaptureSchema = z.object({
  capture_id: z.uuid(),
  claim_token: z.uuid(),
  raw_hex: z.string().regex(/^(?:[0-9a-f]{2})*$/),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  key_version: z.string().min(1),
  key_families: z.array(piggyvestWebhookKeyFamilySchema).min(1),
  attempts: z.int().positive(),
  event_type: z.string().nullable(),
  provider_transaction_id: z.string().nullable(),
});

export type PiggyvestClaimedCapture = z.infer<
  typeof piggyvestClaimedCaptureSchema
>;

const nullableTimestampSchema = z.string().nullable();

export const piggyvestCaptureStatusSchema = z.object({
  pending: z.int().nonnegative(),
  claimed: z.int().nonnegative(),
  needsReview: z.int().nonnegative(),
  oldestUnprocessedAt: nullableTimestampSchema,
  lastCapturedAt: nullableTimestampSchema,
  lastProcessedAt: nullableTimestampSchema,
});

export type PiggyvestCaptureStatus = z.infer<
  typeof piggyvestCaptureStatusSchema
>;
