import {
  type PiggyvestWebhookEvent,
  piggyvestWebhookEventSchema,
} from '@/schemas/piggyvest/events';

/**
 * A captured delivery's stored bytes read exactly as the receiver's parser
 * reads them (strict UTF-8, JSON, the event schema), or null when that
 * parser would reject them: a content quarantine, which only a parser fix
 * plus a resend can clear. Reading the bytes grants no authority.
 */
export function parseStoredPiggyvestEvent(
  rawBody: Uint8Array
): PiggyvestWebhookEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    return null;
  }
  const parsed = piggyvestWebhookEventSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
