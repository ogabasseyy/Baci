import { buildTelLink } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { notifyNegotiationResponseWithFallback } from '@/lib/negotiation-response-notifier';

const bodySchema = z.object({
  negotiationId: z.uuid(),
  status: z.enum(['accepted', 'rejected']),
});

const NEGOTIATION_RESPONSE_SELECT =
  'id, merchant_id, customer_id, customer_email, customer_phone, type, item_info, offered_price, status';

type ResolvedNegotiation = {
  customer_email: string | null;
  customer_id: string | null;
  customer_phone: string | null;
  id: string;
  item_info: { name?: string | null; product_slug?: string | null } | null;
  merchant_id: string;
  offered_price: number | null;
  status: string;
  type: string;
};

function jsonError(error: string, status: number, code?: string) {
  return NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
}

function notifyResolvedNegotiation({
  accessMerchantId,
  negotiation,
}: {
  accessMerchantId: string;
  negotiation: ResolvedNegotiation;
}) {
  const negotiationStatus = negotiation.status;
  if (negotiationStatus !== 'accepted' && negotiationStatus !== 'rejected') {
    throw new Error('Negotiation has not been resolved yet');
  }
  const resolvedStatus: 'accepted' | 'rejected' = negotiationStatus;

  const negotiationType = negotiation.type;
  if (negotiationType !== 'single' && negotiationType !== 'total') {
    throw new Error('Invalid negotiation type');
  }
  const resolvedType: 'single' | 'total' = negotiationType;

  const itemName = negotiation.item_info?.name ?? null;
  const acceptedPrice =
    negotiationStatus === 'accepted' && negotiation.offered_price != null
      ? Number(negotiation.offered_price)
      : null;
  const productSlug = negotiation.item_info?.product_slug ?? null;

  return notifyNegotiationResponseWithFallback({
    acceptedPrice,
    customerEmail: negotiation.customer_email,
    customerId: negotiation.customer_id,
    itemName,
    merchantId: accessMerchantId,
    negotiationId: negotiation.id,
    negotiationType: resolvedType,
    productSlug,
    status: resolvedStatus,
  });
}

export async function POST(request: NextRequest) {
  const {
    user,
    error: authError,
    supabase,
  } = await authenticateApiRequest(request);

  if (authError || !user || !supabase) {
    return jsonError('Unauthorized', 401);
  }

  const access = await getUserAccess(supabase);
  if (!access || !hasPermission(access, 'orders', 'edit')) {
    return jsonError('Forbidden', 403);
  }

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON payload', 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }

  const { negotiationId, status } = parsed.data;
  const { data: negotiation, error: updateError } = await supabase
    .from('negotiation_requests')
    .update({ status })
    .eq('id', negotiationId)
    .eq('merchant_id', access.merchantId)
    .eq('status', 'pending')
    .select(NEGOTIATION_RESPONSE_SELECT)
    .single<ResolvedNegotiation>();

  if (updateError && updateError.code !== 'PGRST116') {
    return jsonError(
      'Failed to resolve. Please try again.',
      502,
      'update_failed'
    );
  }

  if (!negotiation) {
    return jsonError(
      'This request was already handled. Pull to refresh.',
      409,
      'already_resolved'
    );
  }

  try {
    const result = await notifyResolvedNegotiation({
      accessMerchantId: access.merchantId,
      negotiation,
    });
    const hasManualContact = Boolean(buildTelLink(negotiation.customer_phone));
    return NextResponse.json({
      status,
      ...result,
      ...(hasManualContact ? { manualContactAvailable: true } : {}),
    });
  } catch (error) {
    const { data: rolledBack, error: rollbackError } = await supabase
      .from('negotiation_requests')
      .update({ status: 'pending' })
      .eq('id', negotiationId)
      .eq('merchant_id', access.merchantId)
      .eq('status', status)
      .select('id')
      .maybeSingle<{ id: string }>();

    const { logger } = await import('@/lib/logger');
    logger.error({
      message: 'Failed to resolve negotiation request',
      error,
      negotiationId,
      rollbackError,
      rolledBack: Boolean(rolledBack),
    });

    if (rollbackError || !rolledBack) {
      return jsonError(
        'Failed to notify the customer and restore request state. Please refresh before retrying.',
        500,
        'rollback_failed'
      );
    }

    return jsonError(
      'Failed to notify the customer. Please try again.',
      502,
      'notification_failed'
    );
  }
}
