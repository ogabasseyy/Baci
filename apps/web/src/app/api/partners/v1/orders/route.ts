import { createHash, randomUUID } from 'node:crypto';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { logger } from '@/lib/logger';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { partnerOrderReceiptSchema } from '@/schemas/partner-order-receipt';
import { orderSchema } from '@/schemas/partner-order-submission';
import { authorizePartnerProfile } from '../partner-profile';
import { getPartnerProfiles } from '../partner-profiles';

export async function POST(request: Request) {
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
    'orders:write',
    getPartnerProfiles()
  );
  if (!access.ok) {
    return access.reason === 'scope_required'
      ? invalid(403, 'SCOPE_REQUIRED')
      : invalid(401, 'UNAUTHORIZED', { 'WWW-Authenticate': 'Bearer' });
  }

  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_.:-]{16,128}$/.test(key)) {
    return invalid(400, 'INVALID_IDEMPOTENCY_KEY');
  }
  const body = await readBoundedJsonBody(request, 8192);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? invalid(413, 'PAYLOAD_TOO_LARGE')
      : invalid(400, 'INVALID_REQUEST');
  }
  const parsed = orderSchema.safeParse(body.body);
  if (!parsed.success) return invalid(400, 'INVALID_REQUEST');

  const { connectionId, merchantId } = access;
  try {
    const limit = await checkTenantRateLimitDetailed(
      'partner-order-submit',
      connectionId,
      {
        maxRequests: 30,
        windowMs: 60_000,
      }
    );
    if (limit.verdict === 'unavailable')
      return invalid(503, 'ORDER_INTAKE_UNAVAILABLE');
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

    const { quote_id, partner_order_id, ...submission } = parsed.data;
    const idempotencyHash = createHash('sha256').update(key).digest('hex');
    const proof = createShippingQuoteRouteProof({
      action: 'submit_partner_order',
      merchantId,
      subjectId: quote_id,
      payload: {
        connection_id: connectionId,
        partner_order_id,
        idempotency_hash: idempotencyHash,
        submission,
      },
    });
    const db = createAnonClient();
    const { data, error } = await db.rpc('submit_partner_order', {
      p_quote_id: quote_id,
      p_merchant_id: merchantId,
      p_connection_id: connectionId,
      p_partner_order_id: partner_order_id,
      p_idempotency_hash: idempotencyHash,
      p_submission: submission,
      p_route_proof: proof,
    });

    if (error?.code === 'P0002' && error.message === 'partner_quote_not_found')
      return invalid(404, 'QUOTE_NOT_FOUND');
    if (
      error?.code === '22023' &&
      error.message === 'partner_order_payment_amount_mismatch'
    )
      return invalid(409, 'ORDER_AMOUNT_MISMATCH');
    if (error?.code === '23505') {
      if (error.message === 'partner_order_conflict')
        return invalid(409, 'ORDER_CONFLICT');
      logger.warn({
        message: 'Unexpected partner order uniqueness conflict',
        connectionId,
        requestId,
      });
      return invalid(503, 'ORDER_INTAKE_UNAVAILABLE');
    }
    if (error) throw new Error('Partner order intake storage unavailable');
    const reply = partnerOrderReceiptSchema.safeParse(data);
    if (!reply.success) {
      logger.error({
        message: 'Invalid partner order intake receipt',
        connectionId,
        requestId,
      });
      return invalid(500, 'ORDER_RESPONSE_INVALID');
    }
    return Response.json(
      { ...reply.data, request_id: requestId },
      { status: reply.data.status === 'accepted' ? 200 : 202, headers }
    );
  } catch {
    logger.warn({
      message: 'Partner order intake unavailable',
      connectionId,
      requestId,
    });
    return invalid(503, 'ORDER_INTAKE_UNAVAILABLE');
  }
}
