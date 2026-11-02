import { mapKnownGiglStatus } from '@baci/shared/lib/gigl-tracking-status';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { readGiglWebhookBody } from '@/lib/shipping/gigl-webhook-body';
import { readGiglWebhookConfig } from '@/lib/shipping/gigl-webhook-config';
import { openGiglWebhookDelivery } from '@/lib/shipping/gigl-webhook-delivery';
import { createGiglWebhookExpediteClient } from '@/lib/shipping/gigl-webhook-expedite-client';
import {
  GIGL_WEBHOOK_ACKNOWLEDGEMENT,
  GIGL_WEBHOOK_NO_STORE,
} from '@/lib/shipping/gigl-webhook-response-constants';
import { giglWebhookExpediteResultSchema } from '@/schemas/gigl-webhook-expedite-result';

/**
 * GIG Logistics status webhook (Agility "add-webhook-user" registration).
 *
 * Contract:
 * - GIG POSTs base64(salt | iv | AES-256-CBC ciphertext) with no signature
 *   header; decrypting with the registration secret is the only proof of
 *   origin, and the decrypted UserId/ChannelCode must be Baci's account.
 * - GIG retries anything but 200, and expects the acknowledgement below.
 * - A delivery is a hint, never truth: it only makes the waybill's GIGL
 *   monitor due, and the VPS poller reads the authoritative status from
 *   GIG's tracking API, so order updates and customer notifications keep
 *   their single existing writer. A retry, replay or repeat of a status the
 *   poller already recorded never polls faster than the normal cadence.
 *
 * Status mapping:
 * - Settings missing -> 503 before the body is read (GIG retries).
 * - Body over the cap -> 413; unreadable body -> 400.
 * - Any decrypt, parse, schema or account failure -> one constant 401.
 *   AES-CBC has no MAC, so distinguishable failures would be an oracle.
 * - Worker capability or database failure -> 503 (GIG retries).
 * - Accepted, including waybills Baci does not track -> 200.
 *
 * The origin check exempts /api/webhooks/*, and the proxy rate-limits this
 * path per IP (rate-limit-routes.ts) before any key derivation runs.
 */

function unavailable(): NextResponse {
  return NextResponse.json(
    { error: 'Webhook unavailable', code: 'GIGL_WEBHOOK_UNAVAILABLE' },
    { status: 503, headers: GIGL_WEBHOOK_NO_STORE }
  );
}

export function GET(): Response {
  // Reachability probe for registration; carries no state.
  return NextResponse.json(
    { status: 'ok' },
    { headers: GIGL_WEBHOOK_NO_STORE }
  );
}

export async function POST(request: Request): Promise<Response> {
  const config = readGiglWebhookConfig(process.env);
  if (!config) {
    logger.error({ message: 'GIGL webhook settings are not configured' });
    return unavailable();
  }

  const body = await readGiglWebhookBody(request);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? NextResponse.json(
          { error: 'Payload too large', code: 'GIGL_WEBHOOK_TOO_LARGE' },
          { status: 413, headers: GIGL_WEBHOOK_NO_STORE }
        )
      : NextResponse.json(
          { error: 'Unreadable payload', code: 'GIGL_WEBHOOK_UNREADABLE' },
          { status: 400, headers: GIGL_WEBHOOK_NO_STORE }
        );
  }

  const delivery = await openGiglWebhookDelivery(body.text, config);
  if (!delivery.ok) {
    logger.warn({
      message: 'Rejected GIGL webhook delivery',
      reason: delivery.reason,
    });
    return NextResponse.json(
      { error: 'Invalid webhook payload', code: 'GIGL_WEBHOOK_REJECTED' },
      { status: 401, headers: GIGL_WEBHOOK_NO_STORE }
    );
  }

  let client: ReturnType<typeof createGiglWebhookExpediteClient>;
  try {
    client = createGiglWebhookExpediteClient(process.env);
  } catch {
    logger.error({ message: 'GIGL webhook worker capability is invalid' });
    return unavailable();
  }

  const { data, error } = await client.expedite(
    delivery.waybill,
    delivery.statusCode
  );
  if (error) {
    logger.error({
      message: 'GIGL webhook could not expedite tracking',
      code: error.code ?? null,
    });
    return unavailable();
  }

  const result = giglWebhookExpediteResultSchema.safeParse(data);
  if (!result.success) {
    // Contract drift must not swallow the hint: let GIG retry it.
    logger.error({
      message: 'GIGL webhook expedite returned an invalid result',
    });
    return unavailable();
  }
  logger.info({
    message: 'GIGL webhook accepted',
    waybill: delivery.waybill,
    statusCode: delivery.statusCode,
    // false flags a code GIG pushes that the tracking normalizer cannot
    // map yet (the poller would pause on it), so the map can be extended.
    statusMapped: delivery.statusCode
      ? mapKnownGiglStatus(delivery.statusCode) !== null
      : null,
    matched: result.data.matched,
    expedited: result.data.expedited,
  });

  return NextResponse.json(GIGL_WEBHOOK_ACKNOWLEDGEMENT, {
    headers: GIGL_WEBHOOK_NO_STORE,
  });
}
