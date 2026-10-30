import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  type PiggyvestCaptureResult,
  piggyvestCaptureResultSchema,
} from '@/schemas/piggyvest/webhook-capture';
import { normalizePiggyvestSignature } from './verify-piggyvest-payload-signature';
import type {
  PiggyvestWebhookKeyFamily,
  PiggyvestWebhookKeyStatus,
} from './webhook-secret-union';

/**
 * Durable, always-on capture of verified PiggyVest deliveries (R5).
 *
 * The receiver stores the exact request bytes before it answers 200, for
 * every event type, independent of any financial-processing flag. The
 * client is injected by the route: the event-pipeline boundary lets the
 * route reach the intake service authority directly, not through an
 * intermediate importer, so this module never imports it.
 */

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_CAPTURED_HEADERS = 24;
const CAPTURED_HEADER_NAMES = new Set([
  'content-type',
  'content-length',
  'user-agent',
  'x-request-id',
  'x-vercel-id',
]);

export interface CaptureDeliveryInput {
  rawBody: Uint8Array;
  headers: Headers;
  /** Canonical lowercase hex, already verified under `keyVersion`. */
  signature: string;
  keyVersion: string;
  keyFamilies: readonly PiggyvestWebhookKeyFamily[];
  keyStatus: Exclude<PiggyvestWebhookKeyStatus, 'replay-only'>;
}

export interface DeliveryDescription {
  eventId: string | null;
  eventType: string | null;
  providerTransactionId: string | null;
}

function boundedString(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    ? value
    : null;
}

/**
 * Best-effort routing identifiers read from the stored bytes. Never throws:
 * a body we cannot parse is still captured, keyed by its digest.
 */
export function describeDelivery(rawBody: Uint8Array): DeliveryDescription {
  const none: DeliveryDescription = {
    eventId: null,
    eventType: null,
    providerTransactionId: null,
  };
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    return none;
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    return none;
  }
  const envelope = decoded as Record<string, unknown>;
  const data =
    typeof envelope.eventData === 'object' &&
    envelope.eventData !== null &&
    !Array.isArray(envelope.eventData)
      ? (envelope.eventData as Record<string, unknown>)
      : {};
  return {
    eventId: boundedString(envelope.eventId, MAX_IDENTIFIER_LENGTH),
    eventType: boundedString(envelope.eventType, 200),
    // Inflows carry transaction_id; payouts and most other events carry the
    // provider record id as eventData.id.
    providerTransactionId:
      boundedString(data.transaction_id, MAX_IDENTIFIER_LENGTH) ??
      boundedString(data.id, MAX_IDENTIFIER_LENGTH),
  };
}

/**
 * Allowlisted request headers for debugging and exact replay. Credentials
 * (authorization, cookies) and client network identity are never stored.
 */
export function selectCapturedHeaders(
  headers: Headers
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (Object.keys(selected).length >= MAX_CAPTURED_HEADERS) break;
    const key = name.toLowerCase();
    if (CAPTURED_HEADER_NAMES.has(key) || key.startsWith('x-pvb-')) {
      selected[key] = value.slice(0, MAX_HEADER_VALUE_LENGTH);
    }
  }
  return selected;
}

export async function captureVerifiedDelivery(
  supabase: PiggyvestIntakeServiceClient,
  input: CaptureDeliveryInput
): Promise<PiggyvestCaptureResult> {
  const db: SupabaseClient = supabase;
  // The database enforces the same shape; failing here keeps a malformed
  // command from ever reaching storage.
  if (normalizePiggyvestSignature(input.signature) !== input.signature) {
    throw new Error('PiggyVest webhook capture failed');
  }
  const description = describeDelivery(input.rawBody);
  const { data, error } = await db.rpc('capture_piggyvest_webhook_delivery', {
    p_command: {
      rawHex: Buffer.from(input.rawBody).toString('hex'),
      bodyDigest: createHash('sha256').update(input.rawBody).digest('hex'),
      signature: input.signature,
      eventId: description.eventId,
      eventType: description.eventType,
      providerTransactionId: description.providerTransactionId,
      headers: selectCapturedHeaders(input.headers),
      keyVersion: input.keyVersion,
      keyFamilies: [...input.keyFamilies],
      keyStatus: input.keyStatus,
    },
  });
  // Detail from the database (hosts, constraint names) stays out of the
  // thrown message: callers log it and the route never echoes it.
  if (error) throw new Error('PiggyVest webhook capture failed');
  const parsed = piggyvestCaptureResultSchema.safeParse(data);
  if (!parsed.success) throw new Error('PiggyVest webhook capture failed');
  return parsed.data;
}

/**
 * Inline completion after the receiver processed the delivery itself.
 * Best effort by design: a row left `pending` is picked up by the drain
 * and replays idempotently, so a failure here must never change the reply.
 */
export async function markCaptureProcessed(
  supabase: PiggyvestIntakeServiceClient,
  captureId: string
): Promise<void> {
  const db: SupabaseClient = supabase;
  try {
    const { error } = await db.rpc('resolve_piggyvest_webhook_capture', {
      p_id: captureId,
      p_claim_token: null,
      p_state: 'processed',
      p_error: null,
    });
    if (error) {
      console.warn('[PiggyVest Webhook] Failed to mark capture processed');
    }
  } catch {
    console.warn('[PiggyVest Webhook] Failed to mark capture processed');
  }
}
