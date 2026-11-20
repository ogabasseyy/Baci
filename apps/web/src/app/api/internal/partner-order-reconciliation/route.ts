import { randomUUID } from 'node:crypto';
import { authorizePartnerProfile } from '@/app/api/partners/v1/partner-profile';
import { getPartnerProfiles } from '@/app/api/partners/v1/partner-profiles';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { logger } from '@/lib/logger';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimitDetailed } from '@/lib/tenant-rate-limit';
import { evidenceSchema } from '@/schemas/partner-reconciliation-evidence';
import { outcomeSchema } from '@/schemas/partner-reconciliation-outcome';

export async function POST(request: Request) {
  const requestId = randomUUID();
  const headers = { 'Cache-Control': 'private, no-store' };
  const reply = (body: object, status: number) =>
    Response.json({ ...body, request_id: requestId }, { status, headers });
  const reject = (
    status: number,
    code: string,
    extraHeaders: Record<string, string> = {}
  ) =>
    Response.json(
      { error: { code }, request_id: requestId },
      { status, headers: { ...headers, ...extraHeaders } }
    );

  const access = authorizePartnerProfile(
    request.headers.get('authorization'),
    'reconciliation:write',
    getPartnerProfiles()
  );
  if (!access.ok) {
    logger.warn({
      message: 'Partner verifier access rejected',
      reason: access.reason,
      requestId,
    });
    return reject(404, 'NOT_FOUND');
  }

  const bounded = await readBoundedJsonBody(request, 8192);
  if (!bounded.ok) {
    return bounded.reason === 'too_large'
      ? reject(413, 'PAYLOAD_TOO_LARGE')
      : reject(400, 'INVALID_REQUEST');
  }
  const parsed = evidenceSchema.safeParse(bounded.body);
  if (!parsed.success) return reject(400, 'INVALID_REQUEST');

  const { merchantId, connectionId } = access;
  try {
    const limit = await checkTenantRateLimitDetailed(
      'partner-reconciliation',
      connectionId,
      {
        maxRequests: 30,
        windowMs: 60_000,
      }
    );
    if (limit.verdict === 'unavailable') {
      return reject(503, 'RECONCILIATION_UNAVAILABLE');
    }
    if (limit.verdict === 'denied') {
      const reset = limit.resetAt ?? Date.now() + 60_000;
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return reject(429, 'RATE_LIMITED', { 'Retry-After': String(retryAfter) });
    }

    const { submission_id, ...evidence } = parsed.data;
    const proof = createShippingQuoteRouteProof({
      action: 'reconcile_verified_partner_order',
      merchantId,
      subjectId: submission_id,
      payload: { connection_id: connectionId, evidence },
    });
    const db = createStorefrontOrderRpcClient({
      fallbackClient: createAnonClient(),
      hasCanonicalDeliveryMetadata: false,
      merchantId,
      userId: null,
    });
    const { data, error } = await db.rpc('reconcile_verified_partner_order', {
      p_submission_id: submission_id,
      p_merchant_id: merchantId,
      p_connection_id: connectionId,
      p_evidence: evidence,
      p_route_proof: proof,
    });
    if (
      error?.code === 'P0002' &&
      error.message === 'partner_submission_not_found'
    ) {
      logger.warn({
        message: 'Partner reconciliation submission not found',
        requestId,
      });
      return reject(404, 'NOT_FOUND');
    }
    if (
      error?.code === '22023' &&
      error.message === 'partner_capture_timestamp_after_receipt'
    ) {
      logger.warn({
        message: 'Partner capture timestamp after submission receipt',
        connectionId,
        requestId,
      });
      return reject(409, 'CAPTURE_TIMESTAMP_AFTER_RECEIPT');
    }
    // Settlement mismatches are returned by the RPC as review holds, while
    // a capture mismatch rejects the evidence before recording a capture.
    if (
      error?.code === '22023' &&
      error.message === 'partner_payment_evidence_mismatch'
    )
      return reject(400, 'CAPTURE_EVIDENCE_MISMATCH');
    if (
      error?.code === '23505' &&
      error.message === 'partner_payment_evidence_conflict'
    ) {
      return reject(409, 'CAPTURE_EVIDENCE_CONFLICT');
    }
    if (
      error?.code === '23505' &&
      error.message === 'partner_accepted_settlement_evidence_conflict'
    ) {
      return reject(409, 'SETTLEMENT_EVIDENCE_CONFLICT');
    }
    if (error?.code === '23505') {
      logger.warn({
        message: 'Unexpected partner reconciliation uniqueness conflict',
        connectionId,
        requestId,
      });
      return reject(409, 'RECONCILIATION_CONFLICT');
    }
    // The proof is minted by Baci after verifier authentication and validation.
    if (error?.code === '42501') {
      logger.error({
        message: 'Partner reconciliation database authorization rejected',
        connectionId,
        requestId,
      });
      return reject(503, 'RECONCILIATION_UNAVAILABLE');
    }
    if (error) throw new Error('Partner reconciliation unavailable');
    const outcome = outcomeSchema.safeParse(data);
    if (!outcome.success) {
      logger.error({
        message: 'Partner reconciliation returned an invalid receipt',
        connectionId,
        requestId,
      });
      return reject(500, 'RECONCILIATION_RESPONSE_INVALID');
    }
    return reply(
      outcome.data,
      outcome.data.receipt.status === 'accepted' ? 200 : 202
    );
  } catch {
    logger.warn({
      message: 'Partner reconciliation unavailable',
      connectionId,
      requestId,
    });
    return reject(503, 'RECONCILIATION_UNAVAILABLE');
  }
}
