import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { BANK_CARD_OFFERS } from '@/config/bank-card-offers';
import { scheduleCheckoutProductBlogPurge } from '@/lib/checkout/schedule-checkout-product-blog-purge';
import type { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import type { recordPlatformOrderCreatedEvent } from '@/lib/events/record-platform-order-created-event';
import { getOrderItemProductId } from '@/lib/immediate-order/order-item-primitives';
import { logger } from '@/lib/logger';
import { stableStringify } from '@/lib/stable-stringify';
import type { OrderCreateInput } from '@/schemas/orders';

export async function prepareBankCardOfferOrder({
  body,
  merchantId,
  customerEmail,
  userId,
  userEmail,
  requestIdempotencyKey,
  hasVoucherItem,
  clientIp,
  clientUserAgent,
  supabase,
  createScopedClient,
  recordOrderCreated,
}: {
  body: OrderCreateInput;
  merchantId: string;
  customerEmail: string;
  userId?: string | null;
  userEmail?: string | null;
  requestIdempotencyKey: string | null;
  hasVoucherItem: boolean;
  clientIp: string;
  clientUserAgent?: string;
  supabase: SupabaseClient;
  createScopedClient: typeof createStorefrontOrderRpcClient;
  recordOrderCreated: typeof recordPlatformOrderCreatedEvent;
}) {
  if (body.payment_method !== 'bank_card_offer')
    return { kind: 'standard' } as const;
  // The validated request is the replay contract, including the buyer's
  // accepted total. Key order is normalized. Changed values under the same
  // key fail with checkout_idempotency_conflict before order creation.
  const requestHash = createHash('sha256')
    .update(stableStringify(body))
    .digest('hex');
  const offer = BANK_CARD_OFFERS.find(
    (candidate) =>
      candidate.id === body.bank_card_offer_id &&
      candidate.merchantId === merchantId &&
      candidate.enabled
  );
  if (
    !userId ||
    userEmail?.trim().toLowerCase() !== customerEmail.trim().toLowerCase()
  ) {
    return {
      kind: 'response',
      response: NextResponse.json(
        {
          code: 'BANK_CARD_OFFER_BUYER_REQUIRED',
          error: 'Sign in with the checkout email for this bank card offer',
        },
        { status: userId ? 403 : 401 }
      ),
    } as const;
  }
  // Voucher checkout never reads the header key and cannot use a bank offer.
  // Return the incompatibility below even if the original request had no key.
  if (!requestIdempotencyKey && !hasVoucherItem) {
    return {
      kind: 'response',
      response: NextResponse.json(
        {
          code: 'BANK_CARD_OFFER_CHECKOUT_KEY_REQUIRED',
          error: 'A checkout key is required for this bank card offer',
        },
        { status: 400 }
      ),
    } as const;
  }
  if (
    !body.bank_card_offer_id ||
    !requestIdempotencyKey ||
    body.shared_cart ||
    hasVoucherItem ||
    body.discount_code ||
    body.use_wallet_credit ||
    body.wallet_amount ||
    body.use_savings_credit ||
    body.savings_amount
  ) {
    return {
      kind: 'response',
      response: NextResponse.json(
        {
          code: 'BANK_CARD_OFFER_UNAVAILABLE',
          error: 'Bank card offer unavailable for this checkout',
        },
        { status: 409 }
      ),
    } as const;
  }
  async function repairBankOfferOrderEffects(
    offerOrder: Record<string, unknown>,
    merchantSlug: string
  ) {
    if (typeof offerOrder.id !== 'string') return;
    try {
      await scheduleCheckoutProductBlogPurge({
        merchantId,
        merchantSlug,
        orderId: offerOrder.id,
        orderItems: body.items.map((item) => ({
          product_id: getOrderItemProductId(item),
          variant_id: item.variantId || item.variant_id,
        })),
        supabase,
      });
    } catch (error) {
      logger.error({
        message:
          'Failed to revalidate product caches after bank offer order creation',
        merchantId,
        error,
      });
    }
    // Replay repairs a missed enqueue. The recorder uses the saved order ID
    // as platform_purchase:<orderId>, deduplicated by record_platform_domain_event_v1.
    try {
      await recordOrderCreated({
        currency:
          typeof offerOrder.currency === 'string' ? offerOrder.currency : 'NGN',
        customerEmail,
        eventTimestamp:
          typeof offerOrder.created_at === 'string'
            ? offerOrder.created_at
            : new Date().toISOString(),
        ipAddress: clientIp,
        merchantId,
        orderId: offerOrder.id,
        orderNumber:
          typeof offerOrder.order_number === 'string' && offerOrder.order_number
            ? offerOrder.order_number
            : offerOrder.id.slice(0, 8).toUpperCase(),
        userAgent: clientUserAgent,
        value: Number(offerOrder.total ?? 0),
      });
    } catch (error) {
      logger.error({
        message: 'Failed to record the bank offer order event',
        merchantId,
        orderId: offerOrder.id,
        error,
      });
    }
  }

  const scopedClient = createScopedClient({
    fallbackClient: supabase,
    hasCanonicalDeliveryMetadata: false,
    merchantId,
    userId,
  });
  const replay = await scopedClient.rpc('get_bank_card_offer_checkout_replay', {
    p_merchant_id: merchantId,
    p_key: requestIdempotencyKey,
    p_hash: requestHash,
  });
  if (replay.error) {
    const conflict = replay.error.message === 'checkout_idempotency_conflict';
    const retired = replay.error.message === 'order_not_reusable';
    return {
      kind: 'response',
      response: NextResponse.json(
        {
          code: conflict
            ? 'CHECKOUT_IDEMPOTENCY_CONFLICT'
            : retired
              ? 'CHECKOUT_ORDER_NOT_REUSABLE'
              : 'BANK_CARD_OFFER_REPLAY_UNAVAILABLE',
          error: conflict
            ? 'This checkout key has already been used for a different order'
            : retired
              ? 'This checkout order can no longer be reused. Refresh checkout and start a new order.'
              : 'Unable to load this bank card offer order',
        },
        { status: conflict || retired ? 409 : 503 }
      ),
    } as const;
  }
  if (replay.data) {
    const { data: replayMerchant, error: merchantError } = await supabase
      .from('merchants')
      .select('slug')
      .eq('id', merchantId)
      .maybeSingle();
    if (merchantError || !replayMerchant?.slug) {
      return {
        kind: 'response',
        response: NextResponse.json(
          {
            code: 'BANK_CARD_OFFER_REPLAY_UNAVAILABLE',
            error: 'Unable to load this bank card offer order',
          },
          { status: 503 }
        ),
      } as const;
    }
    await repairBankOfferOrderEffects(replay.data, replayMerchant.slug);
    return {
      kind: 'response',
      response: NextResponse.json(
        { order: replay.data, idempotency: { replayed: true } },
        { headers: { 'x-idempotency-replayed': 'true' } }
      ),
    } as const;
  }
  if (!offer) {
    return {
      kind: 'response',
      response: NextResponse.json(
        {
          code: 'BANK_CARD_OFFER_UNAVAILABLE',
          error: 'Bank card offer unavailable for this checkout',
        },
        { status: 409 }
      ),
    } as const;
  }
  return {
    kind: 'checkout',
    offer,
    requestHash,
    userId,
    repairEffects: repairBankOfferOrderEffects,
  } as const;
}
