import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCrossRemConnections } from '@/app/api/partners/v1/catalog/catalog-bindings';
import { partnerOrderReceiptSchema } from '@/app/api/partners/v1/order-receipt';
import { authorizePartner } from '@/app/api/partners/v1/partner-connection';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { logger } from '@/lib/logger';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import { createAnonClient } from '@/lib/supabase/anon';
import { checkTenantRateLimit } from '@/lib/tenant-rate-limit';

const reference = z.string().trim().min(1).max(200);
const moneyEvidence = {
  source: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  amount_minor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
};
const evidenceSchema = z.strictObject({
  submission_id: z.uuid(),
  quote_id: z.uuid(),
  partner_order_id: z.string().trim().min(1).max(128),
  capture: z.strictObject({
    ...moneyEvidence,
    provider_account: reference,
    reference,
    captured_at: z.iso.datetime({ offset: true }),
  }),
  settlement: z
    .strictObject({
      ...moneyEvidence,
      settlement_account: reference,
      payout_reference: reference,
      allocation_reference: reference,
      settled_at: z.iso.datetime({ offset: true }),
    })
    .optional(),
});
const outcomeSchema = z.object({
  receipt: partnerOrderReceiptSchema,
  hold_reason: z
    .enum(['SETTLEMENT_REVIEW_REQUIRED', 'ORDER_REVIEW_REQUIRED'])
    .nullable(),
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  const headers = { 'Cache-Control': 'private, no-store' };
  const reply = (body: object, status: number) =>
    Response.json({ ...body, request_id: requestId }, { status, headers });
  const reject = (status: number, code: string) =>
    reply({ error: { code } }, status);

  const connections = getCrossRemConnections();
  const [pilot] = connections;
  const access = authorizePartner(
    request.headers.get('authorization'),
    [
      ...connections,
      {
        id: pilot.id,
        merchantId: pilot.merchantId,
        token: process.env.CROSSREM_VERIFIER_TOKEN,
        scopes: ['reconciliation:write'],
      },
    ],
    'reconciliation:write'
  );
  if (!access.ok) return reject(404, 'NOT_FOUND');

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
    const limit = await checkTenantRateLimit(
      'partner-reconciliation',
      connectionId,
      {
        maxRequests: 30,
        windowMs: 60_000,
      }
    );
    if (limit === 'unavailable')
      return reject(503, 'RECONCILIATION_UNAVAILABLE');
    if (limit === 'denied') return reject(429, 'RATE_LIMITED');

    const { submission_id, ...evidence } = parsed.data;
    const proof = createShippingQuoteRouteProof({
      action: 'reconcile_verified_partner_order',
      merchantId,
      subjectId: submission_id,
      payload: { connection_id: connectionId, evidence },
    });
    const { data, error } = await createAnonClient().rpc(
      'reconcile_verified_partner_order',
      {
        p_submission_id: submission_id,
        p_merchant_id: merchantId,
        p_connection_id: connectionId,
        p_evidence: evidence,
        p_route_proof: proof,
      }
    );
    if (error?.code === 'P0002') return reject(404, 'NOT_FOUND');
    if (error?.code === '22023' || error?.code === '23505') {
      return reject(409, 'CAPTURE_EVIDENCE_CONFLICT');
    }
    if (error) throw new Error('Partner reconciliation unavailable');
    const outcome = outcomeSchema.parse(data);
    return reply(outcome, outcome.receipt.status === 'accepted' ? 200 : 202);
  } catch {
    logger.warn({
      message: 'Partner reconciliation unavailable',
      connectionId,
      requestId,
    });
    return reject(503, 'RECONCILIATION_UNAVAILABLE');
  }
}
