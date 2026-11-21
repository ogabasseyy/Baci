import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { logger } from '@/lib/logger';
import { captureServerEvent } from '@/lib/posthog/server';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { orderTrackingSchema } from '@/schemas/partner-order-tracking';
import { authorizePartnerProfile } from '../../partner-profile';
import { getPartnerProfiles } from '../../partner-profiles';

export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const requestId = randomUUID();
  const headers = { 'Cache-Control': 'private, no-store' };
  function invalid(status: number, code: string, additionalHeaders = {}) {
    return Response.json(
      { error: { code }, request_id: requestId },
      { status, headers: { ...headers, ...additionalHeaders } }
    );
  }
  const access = authorizePartnerProfile(
    request.headers.get('authorization'),
    'orders:read',
    getPartnerProfiles()
  );
  if (!access.ok) {
    return access.reason === 'scope_required'
      ? invalid(403, 'SCOPE_REQUIRED')
      : invalid(401, 'UNAUTHORIZED', { 'WWW-Authenticate': 'Bearer' });
  }

  const orderId = orderTrackingSchema.shape.order_id.safeParse(
    (await context.params).orderId
  );
  if (!orderId.success) return invalid(400, 'INVALID_REQUEST');

  const { connectionId, merchantId } = access;
  try {
    const limit = await checkTenantRateLimitDetailed(
      'partner-order-read',
      connectionId,
      {
        maxRequests: 120,
        windowMs: 60_000,
      }
    );
    if (limit.verdict === 'unavailable')
      return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
    if (limit.verdict === 'denied') {
      const now = Date.now();
      const retryAfter = Math.max(
        1,
        Math.ceil(((limit.resetAt ?? now + 60_000) - now) / 1000)
      );
      return invalid(429, 'RATE_LIMITED', {
        'Retry-After': String(retryAfter),
      });
    }

    const proof = createShippingQuoteRouteProof({
      action: 'read_partner_order_tracking',
      merchantId,
      subjectId: orderId.data,
      payload: { connection_id: connectionId },
    });
    const { data, error } = await createAnonClient().rpc(
      'read_partner_order_tracking',
      {
        p_merchant_id: merchantId,
        p_order_id: orderId.data,
        p_connection_id: connectionId,
        p_route_proof: proof,
      }
    );
    // Baci mints the proof after partner credential and scope validation.
    if (error?.code === '42501') {
      logger.error({
        message: 'Partner tracking database authorization rejected',
        connectionId,
        requestId,
      });
      return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
    }
    if (error) throw new Error('Partner tracking storage unavailable');
    if (data === null) return invalid(404, 'ORDER_NOT_FOUND');

    const reply = orderTrackingSchema.safeParse(data);
    if (!reply.success) {
      logger.error({
        message: 'Invalid partner tracking response',
        connectionId,
        requestId,
      });
      return invalid(500, 'ORDER_RESPONSE_INVALID');
    }
    const paymentStatusUnknown = reply.data.payment_status === 'unknown';
    const shippingStatusUnknown = reply.data.shipping_status === 'unknown';
    if (paymentStatusUnknown || shippingStatusUnknown) {
      logger.warn({
        message: 'Unrecognized partner tracking status',
        connectionId,
        requestId,
        paymentStatusUnknown,
        shippingStatusUnknown,
      });
      after(async () => {
        await captureServerEvent('partner_tracking_status_unknown', {
          payment_status_unknown: paymentStatusUnknown,
          shipping_status_unknown: shippingStatusUnknown,
        });
      });
    }
    return Response.json({ ...reply.data, request_id: requestId }, { headers });
  } catch {
    logger.warn({
      message: 'Partner tracking lookup unavailable',
      connectionId,
      requestId,
    });
    return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
  }
}
