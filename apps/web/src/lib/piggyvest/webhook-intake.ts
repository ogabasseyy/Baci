import 'server-only';
import { isUint8Array } from 'node:util/types';
import { piggyvestWebhookEnvelopeSchema } from '@/schemas/piggyvest-webhook-envelope';
import { piggyvestWebhookIntakeConfigurationSchema } from '@/schemas/piggyvest-webhook-intake';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';
import type {
  PiggyvestWebhookInbox,
  PiggyvestWebhookIntakeOutcome,
} from './webhook-inbox.types';
import { PIGGYVEST_WEBHOOK_LIMITS } from './webhook-limits';

export async function acceptPiggyvestStagingWebhook({
  configuration,
  rawPayload,
  signature,
  inbox,
}: {
  configuration: unknown;
  rawPayload: unknown;
  signature: string | null;
  inbox: PiggyvestWebhookInbox;
}): Promise<PiggyvestWebhookIntakeOutcome> {
  const parsedConfiguration =
    piggyvestWebhookIntakeConfigurationSchema.safeParse(configuration);
  if (!parsedConfiguration.success) return 'not_ready';
  if (!isUint8Array(rawPayload) || rawPayload.byteLength === 0) {
    return 'invalid_payload';
  }
  if (rawPayload.byteLength > PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes) {
    return 'payload_too_large';
  }
  const payload = Uint8Array.from(rawPayload);
  if (
    !verifyPiggyvestPayloadSignature({
      payload,
      signature,
      secret: parsedConfiguration.data.secret,
    })
  ) {
    return 'invalid_signature';
  }

  let body: unknown;
  try {
    body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payload)
    );
  } catch {
    return 'invalid_payload';
  }
  const envelope = piggyvestWebhookEnvelopeSchema.safeParse(body);
  if (!envelope.success) return 'invalid_payload';

  try {
    const result = await inbox.enqueue({
      integrationId: parsedConfiguration.data.integrationId,
      eventId: envelope.data.eventId,
      rawPayload: payload,
    });
    return result === 'accepted' ||
      result === 'duplicate' ||
      result === 'conflict'
      ? result
      : 'storage_unavailable';
  } catch {
    return 'storage_unavailable';
  }
}
