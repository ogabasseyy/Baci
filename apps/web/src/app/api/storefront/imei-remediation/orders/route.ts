import { createHmac } from 'node:crypto';
import {
  isValidDeviceIdentifier,
  normalizeDeviceIdentifier,
} from '@baci/shared/imei';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getImeiFxNgnUsd,
  getImeiHashSalt,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getRootDomain,
  isPetrockRemediationEnabled,
  isUsdtWalletEnabled,
} from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { decryptImeiIdentifier } from '@/lib/imei-identifier-crypto';
import {
  isInsufficientWalletBalanceError,
  resolveImeiCustomer,
} from '@/lib/imei-lookup-fulfillment';
import { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { readCustomerPetrockRemediationOrders } from '@/lib/imei-remediation/petrock-remediation-customer-orders';
import { placePetrockRemediationOrder } from '@/lib/imei-remediation/petrock-remediation-order-flow';
import {
  createPetrockRemediationOrderState,
  loadPetrockRemediationOrderContext,
} from '@/lib/imei-remediation/petrock-remediation-order-state';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { createAdminClient } from '@/lib/supabase/admin';
import { imeiRemediationOrderSchema } from '@/schemas/imei-remediation';
import { petrockRemediationOrderRouteHelpers } from './order-route-helpers';

const { errorResponse, hashesMatch, replayResponse } =
  petrockRemediationOrderRouteHelpers;

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return errorResponse('Unauthorized', 'AUTH_REQUIRED', 401);
  }
  if (!isPetrockRemediationEnabled()) {
    return errorResponse('Not found', 'NOT_FOUND', 404);
  }
  const rateLimit = await checkRateLimit(request);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      rateLimit.limit,
      rateLimit.remaining,
      rateLimit.resetTime
    );
  }
  const merchantSlug = new URL(request.url).searchParams.get('merchantSlug');
  const merchant = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: merchantSlug,
    lookupError: 'Failed to validate storefront host',
    notFoundError: 'Remediation is only available on storefront hosts',
    request,
    rootDomain: getRootDomain() || 'usebaci.com',
  });
  if (!merchant.success) {
    return errorResponse(
      merchant.error,
      'STOREFRONT_NOT_FOUND',
      merchant.status
    );
  }
  const merchantId = String(merchant.merchant.id);
  const customer = await resolveImeiCustomer({
    merchantId,
    supabase: auth.supabase,
    user: auth.user,
  });
  if (!customer) {
    return errorResponse('Orders not found', 'ORDER_NOT_FOUND', 404);
  }
  try {
    const orders = await readCustomerPetrockRemediationOrders({
      customerId: customer.id,
      merchantId,
      supabase: auth.supabase,
    });
    return NextResponse.json({ orders, success: true });
  } catch (error) {
    console.error('[Petrock Remediation] Customer order list failed', {
      error,
      merchantId,
    });
    return errorResponse(
      'Unable to load unlock orders',
      'ORDER_READ_FAILED',
      500
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return errorResponse('Unauthorized', 'AUTH_REQUIRED', 401);
  }
  if (!isPetrockRemediationEnabled()) {
    return errorResponse('Not found', 'NOT_FOUND', 404);
  }
  const rateLimit = await checkRateLimit(request);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      rateLimit.limit,
      rateLimit.remaining,
      rateLimit.resetTime
    );
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return response ?? errorResponse('Forbidden', 'CSRF_FAILED', 403);
  }
  const parsed = imeiRemediationOrderSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (
    !parsed.success ||
    !isValidDeviceIdentifier(parsed.data.identifier, 'both')
  ) {
    return errorResponse('Invalid input', 'INVALID_INPUT', 400);
  }
  if (parsed.data.paymentCurrency === 'USDT' && !isUsdtWalletEnabled()) {
    return errorResponse('Not found', 'NOT_FOUND', 404);
  }

  const merchant = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: parsed.data.merchantSlug,
    lookupError: 'Failed to validate storefront host',
    notFoundError: 'Remediation is only available on storefront hosts',
    request,
    rootDomain: getRootDomain() || 'usebaci.com',
  });
  if (!merchant.success) {
    return errorResponse(
      merchant.error,
      'STOREFRONT_NOT_FOUND',
      merchant.status
    );
  }
  const merchantId = String(merchant.merchant.id);
  const customer = await resolveImeiCustomer({
    merchantId,
    supabase: auth.supabase,
    user: auth.user,
  });
  if (!customer) {
    return errorResponse('Order not found', 'ORDER_NOT_FOUND', 404);
  }

  const config = getPetrockConfig();
  const encryptionKey = getImeiIdentifierEncryptionKey();
  const salt = getImeiHashSalt();
  const fxRate = getImeiFxNgnUsd();
  if (
    !config ||
    !encryptionKey ||
    !salt ||
    typeof fxRate !== 'number' ||
    !Number.isFinite(fxRate) ||
    fxRate <= 0
  ) {
    return errorResponse('Service unavailable', 'SERVICE_UNAVAILABLE', 503);
  }

  const supabaseAdmin = createAdminClient();
  const context = await loadPetrockRemediationOrderContext({
    customerId: customer.id,
    merchantId,
    orderId: parsed.data.orderId,
    productId: parsed.data.productId,
    supabaseAdmin,
  });
  const identifier = normalizeDeviceIdentifier(parsed.data.identifier, 'both');
  const identifierHash = createHmac('sha256', salt)
    .update(identifier)
    .digest('hex');
  if (!context || !hashesMatch(identifierHash, context.identifierHash)) {
    return errorResponse('Order not found', 'ORDER_NOT_FOUND', 404);
  }

  const replay = replayResponse(context.order.id, context.order.status);
  if (replay) return replay;
  if (!['eligible', 'payment_pending', 'paid'].includes(context.order.status)) {
    return errorResponse('Order is not payable', 'ORDER_NOT_PAYABLE', 409);
  }
  if (
    context.order.status !== 'eligible' &&
    context.order.paymentCurrency !== parsed.data.paymentCurrency
  ) {
    return errorResponse(
      'The payment currency cannot be changed after confirmation',
      'PAYMENT_CURRENCY_CONFLICT',
      409
    );
  }

  let decryptedIdentifier: string;
  try {
    decryptedIdentifier = normalizeDeviceIdentifier(
      decryptImeiIdentifier(context.identifierCiphertext, encryptionKey),
      'both'
    );
  } catch {
    return errorResponse('Service unavailable', 'IDENTIFIER_UNAVAILABLE', 503);
  }
  if (decryptedIdentifier !== identifier) {
    return errorResponse('Order not found', 'ORDER_NOT_FOUND', 404);
  }

  try {
    const result = await placePetrockRemediationOrder({
      client: createPetrockClient(config),
      fxRate,
      identifier,
      order: {
        ...context.order,
        status: context.order.status as 'eligible' | 'paid' | 'payment_pending',
      },
      origin: new URL(request.url).origin,
      paymentCurrency: parsed.data.paymentCurrency,
      product: context.product,
      state: createPetrockRemediationOrderState({
        customerId: customer.id,
        fxRate,
        merchantId,
        supabaseAdmin,
      }),
    });
    if (result.kind === 'eligibility_failed') {
      return errorResponse(
        'This device no longer qualifies for the selected unlock',
        'REMEDIATION_NOT_ELIGIBLE',
        409
      );
    }
    if (result.kind === 'preflight_failed') {
      return errorResponse(
        'Unlock ordering is temporarily unavailable',
        'REMEDIATION_PREFLIGHT_FAILED',
        503
      );
    }
    if (result.kind === 'submission_unknown') {
      return NextResponse.json(
        {
          orderId: context.order.id,
          pollAfterMs: 60_000,
          status: 'submission_unknown',
          success: true,
        },
        { status: 202 }
      );
    }
    if (result.kind === 'failed') {
      return NextResponse.json({
        orderId: context.order.id,
        status: 'refunded',
        success: true,
      });
    }
    return NextResponse.json(
      {
        orderId: context.order.id,
        pollAfterMs: 30_000,
        status: result.kind === 'pending' ? 'submitted' : 'submitting',
        success: true,
      },
      { status: 202 }
    );
  } catch (error) {
    if (
      isInsufficientWalletBalanceError(
        error as { code?: string; message?: string }
      )
    ) {
      return errorResponse(
        'Insufficient wallet balance',
        'WALLET_INSUFFICIENT',
        402
      );
    }
    console.error('[Petrock Remediation] Order submission failed', {
      error,
      orderId: context.order.id,
    });
    return errorResponse('Unable to place unlock order', 'ORDER_FAILED', 500);
  }
}
