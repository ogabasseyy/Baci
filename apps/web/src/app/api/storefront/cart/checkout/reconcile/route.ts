import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { createCheckoutReconciliationClient } from '@/lib/cart/checkout-reconciliation-client';
import { resolveCheckoutReconciliationAuthority } from '@/lib/cart/checkout-reconciliation-proof';
import {
  checkCartQuota,
  readCartJsonBody,
  resolveCartMerchant,
} from '@/lib/cart/request-context';
import { cartErrorResponse, cartJsonResponse } from '@/lib/cart/response';
import { getRedvaultCheckoutSummary } from '@/lib/checkout/get-redvault-checkout-summary';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  bankTransferCheckoutReceiptSchema,
  cartCheckoutReconciliationReceiptSchema,
  cartCheckoutReconciliationSchema,
} from '@/schemas/cart-checkout-reconciliation';

/** Resolve an uncertain checkout without creating an order or payment. */
export async function POST(request: NextRequest) {
  try {
    if (!(await checkCsrfProtection(request)).valid)
      return cartErrorResponse('forbidden');
    const auth = await authenticateApiRequest(request, {
      requireVerifiedGuest: true,
    });
    if (
      (auth.error && auth.error !== 'Not authenticated') ||
      (auth.user && !z.uuid().safeParse(auth.user.id).success)
    )
      return cartErrorResponse('temporarily_unavailable');
    const body = await readCartJsonBody(request);
    if (!body.ok) return cartErrorResponse('invalid_request');
    const parsed = cartCheckoutReconciliationSchema.safeParse(body.body);
    if (!parsed.success) return cartErrorResponse('invalid_request');
    const input = parsed.data;
    const merchant = await resolveCartMerchant(request, {
      resolveAlias: getCurrentSlugForAlias,
      rpcClient: createAnonClient(),
    });
    if (!merchant.ok) return cartErrorResponse(merchant.error);
    const userId = auth.user?.id ?? null;
    const proof = resolveCheckoutReconciliationAuthority(request, {
      merchantId: merchant.merchant.id,
      cartId: input.cartId,
      sessionId: input.sessionId,
      userId,
    });
    if (!proof.ok) return cartErrorResponse('invalid_proof');
    const quota = await checkCartQuota({
      merchantId: merchant.merchant.id,
      operation: 'checkout_prepare',
      subject: proof.authority.session.principalId,
    });
    if (!quota.allowed) return cartErrorResponse('quota_exceeded');
    const client = createCheckoutReconciliationClient(proof.authority, input);
    if (input.paymentMethod === 'bank_transfer') {
      const response = await client.rpc(
        'commerce_cart_reconcile_bank_transfer_checkout'
      );
      const receipt = bankTransferCheckoutReceiptSchema.safeParse(
        response.data
      );
      if (response.error || !receipt.success)
        return cartErrorResponse('temporarily_unavailable');

      // Payment or cancellation can commit after the cart RPC releases its locks.
      const snapshot = await (auth.supabase ?? createAnonClient()).rpc(
        'get_order_payment_snapshot',
        {
          p_order_id: receipt.data.order.id,
          p_email: input.customerEmail,
        }
      );
      const order = snapshot.data?.[0];
      if (
        snapshot.error ||
        !order ||
        order.merchant_id !== merchant.merchant.id ||
        order.currency !== receipt.data.order.currency ||
        order.payment_method !== 'bank_transfer' ||
        (order.payment_status !== 'unpaid' &&
          order.payment_status !== 'pending') ||
        !order.shipping_status ||
        ['cancelled', 'canceled'].includes(
          order.shipping_status.toLowerCase()
        ) ||
        (order.wallet_amount_used ?? 0) !== 0 ||
        order.total !== receipt.data.amountDueToGateway
      ) {
        return cartErrorResponse('temporarily_unavailable');
      }
      return cartJsonResponse(receipt.data);
    }
    const response = await client.rpc(
      'commerce_cart_reconcile_redvault_checkout' as never
    );
    const receipt = cartCheckoutReconciliationReceiptSchema.safeParse(
      response.data
    );
    if (
      response.error ||
      !receipt.success ||
      receipt.data.kind === 'unavailable'
    )
      return cartErrorResponse('temporarily_unavailable');
    if (receipt.data.kind === 'retired') {
      if (
        receipt.data.cartId !== input.cartId ||
        receipt.data.checkoutSessionId !== input.sessionId ||
        receipt.data.checkoutGeneration !== input.generation
      )
        return cartErrorResponse('temporarily_unavailable');
      return cartJsonResponse(receipt.data);
    }
    const summaryClient = createStorefrontOrderRpcClient({
      fallbackClient: auth.supabase ?? createAnonClient(),
      hasCanonicalDeliveryMetadata: false,
      merchantId: merchant.merchant.id,
      userId,
      redvaultCustomerEmail: input.customerEmail,
    });
    const summary = await getRedvaultCheckoutSummary({
      client: summaryClient,
      orderId: receipt.data.orderId,
    });
    // Payment can complete between the reconciliation RPC and this read.
    if (summary.order.payment_status !== 'unpaid')
      return cartErrorResponse('temporarily_unavailable');
    return cartJsonResponse({
      kind: 'submitted',
      order: summary.order,
      redvault: { quote: summary.quote },
    });
  } catch {
    return cartErrorResponse('temporarily_unavailable');
  }
}
