import 'server-only';
import { giglWebhookEventSchema } from '@/schemas/gigl-webhook-event';
import { extractGiglWebhookCiphertext } from './gigl-webhook-ciphertext';
import type { GiglWebhookConfig } from './gigl-webhook-config';
import { decryptGiglWebhookPayload } from './gigl-webhook-crypto';

export type GiglWebhookRejection =
  | 'malformed'
  | 'undecryptable'
  | 'invalid_event'
  | 'foreign_account';

export type OpenedGiglWebhookDelivery =
  | { ok: true; waybill: string; statusCode: string | null }
  | { ok: false; reason: GiglWebhookRejection };

const normalizeIdentity = (value: string) => value.trim().toUpperCase();

/**
 * Turns a raw GIG delivery into the one fact Baci acts on: which waybill
 * changed. Decryption with the shared secret is the only proof of origin
 * (GIG sends no signature header), and the decrypted account must be
 * Baci's own. The reason is for operator logs only: callers must answer
 * every rejection identically so the endpoint is not a padding oracle.
 */
export async function openGiglWebhookDelivery(
  rawBody: string,
  config: GiglWebhookConfig
): Promise<OpenedGiglWebhookDelivery> {
  const ciphertext = extractGiglWebhookCiphertext(rawBody);
  if (!ciphertext) return { ok: false, reason: 'malformed' };

  const plaintext = await decryptGiglWebhookPayload(ciphertext, config.secret);
  if (plaintext === null) return { ok: false, reason: 'undecryptable' };

  let json: unknown;
  try {
    json = JSON.parse(plaintext);
  } catch {
    return { ok: false, reason: 'invalid_event' };
  }
  const event = giglWebhookEventSchema.safeParse(json);
  if (!event.success) return { ok: false, reason: 'invalid_event' };

  if (
    normalizeIdentity(event.data.UserId) !== normalizeIdentity(config.userId) ||
    normalizeIdentity(event.data.ChannelCode) !==
      normalizeIdentity(config.channelCode)
  ) {
    return { ok: false, reason: 'foreign_account' };
  }

  return {
    ok: true,
    waybill: event.data.Waybill,
    statusCode: event.data.StatusCode ?? null,
  };
}
