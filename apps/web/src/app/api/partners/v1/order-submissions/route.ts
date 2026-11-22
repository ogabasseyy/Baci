import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { partnerOrderReceiptSchema } from '@/schemas/partner-order-receipt';
import { authorizePartnerProfile } from '../partner-profile';
import { getPartnerProfiles } from '../partner-profiles';

export async function GET(request: Request) {
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

  const query = new URL(request.url).searchParams;
  const orderReferences = query.getAll('partner_order_id');
  const partnerOrderId = orderReferences[0]?.trim();
  if (
    orderReferences.length !== 1 ||
    query.size !== orderReferences.length ||
    !partnerOrderId ||
    partnerOrderId.length > 128
  ) {
    return invalid(400, 'INVALID_REQUEST');
  }

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
      action: 'read_partner_order_submission',
      merchantId,
      subjectId: requestId,
      payload: {
        connection_id: connectionId,
        partner_order_id: partnerOrderId,
      },
    });
    const { data, error } = await createAnonClient().rpc(
      'read_partner_order_submission',
      {
        p_merchant_id: merchantId,
        p_request_id: requestId,
        p_connection_id: connectionId,
        p_partner_order_id: partnerOrderId,
        p_route_proof: proof,
      }
    );
    // Baci mints the proof after partner credential and scope validation.
    if (error?.code === '42501') {
      logger.error({
        message: 'Partner order lookup database authorization rejected',
        connectionId,
        requestId,
      });
      return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
    }
    if (error) throw new Error('Partner order lookup storage unavailable');
    if (data === null) return invalid(404, 'ORDER_SUBMISSION_NOT_FOUND');

    const reply = partnerOrderReceiptSchema.safeParse(data);
    if (!reply.success) {
      logger.error({
        message: 'Invalid partner order lookup receipt',
        connectionId,
        requestId,
      });
      return invalid(500, 'ORDER_RESPONSE_INVALID');
    }
    return Response.json({ ...reply.data, request_id: requestId }, { headers });
  } catch {
    logger.warn({
      message: 'Partner order lookup unavailable',
      connectionId,
      requestId,
    });
    return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
  }
}
