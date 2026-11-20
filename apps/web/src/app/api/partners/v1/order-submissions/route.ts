import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimit } from '@/lib/tenant-rate-limit';
import { getCrossRemConnections } from '../catalog/catalog-bindings';
import { partnerOrderReceiptSchema } from '../order-receipt';
import { authorizePartner } from '../partner-connection';

export async function GET(request: Request) {
  const requestId = randomUUID();
  const headers = { 'Cache-Control': 'private, no-store' };
  function invalid(status: number, code: string, additionalHeaders = {}) {
    return Response.json(
      { error: { code }, request_id: requestId },
      { status, headers: { ...headers, ...additionalHeaders } }
    );
  }
  const access = authorizePartner(
    request.headers.get('authorization'),
    getCrossRemConnections(),
    'orders:read'
  );
  if (!access.ok) {
    return access.reason === 'scope_required'
      ? invalid(403, 'SCOPE_REQUIRED')
      : invalid(401, 'UNAUTHORIZED', { 'WWW-Authenticate': 'Bearer' });
  }

  const query = new URL(request.url).searchParams;
  const partnerOrderId = query.get('partner_order_id')?.trim();
  if (query.size !== 1 || !partnerOrderId || partnerOrderId.length > 128) {
    return invalid(400, 'INVALID_REQUEST');
  }

  const { connectionId, merchantId } = access;
  try {
    const limit = await checkTenantRateLimit(
      'partner-order-read',
      connectionId,
      {
        maxRequests: 120,
        windowMs: 60_000,
      }
    );
    if (limit === 'unavailable')
      return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
    if (limit === 'denied') return invalid(429, 'RATE_LIMITED');

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
    if (error) throw new Error('Partner order lookup storage unavailable');
    if (data === null) return invalid(404, 'ORDER_SUBMISSION_NOT_FOUND');

    return Response.json(
      { ...partnerOrderReceiptSchema.parse(data), request_id: requestId },
      { headers }
    );
  } catch {
    logger.warn({
      message: 'Partner order lookup unavailable',
      connectionId,
      requestId,
    });
    return invalid(503, 'ORDER_LOOKUP_UNAVAILABLE');
  }
}
