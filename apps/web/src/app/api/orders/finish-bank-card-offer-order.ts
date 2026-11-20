import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { quoteBankCardOffer } from '@/lib/checkout/bank-card-offer-quote';
import { createBankCardOfferCheckout } from '@/lib/checkout/create-bank-card-offer-checkout';
import { logger } from '@/lib/logger';
import { isMajorAmountRepresentable } from '@/lib/money/is-major-amount-representable';
import type { BankCardOffer } from '@/schemas/bank-card-offer';

export async function finishBankCardOfferOrder({
  offer,
  userId,
  requestHash,
  repairEffects,
  client,
  orderArgs,
  items,
  fees,
  currency,
  expectedTotal,
  hasIncompatibleDiscount,
  merchantId,
  merchantSlug,
}: {
  offer: BankCardOffer;
  userId: string;
  requestHash: string;
  repairEffects: (
    order: Record<string, unknown>,
    slug: string
  ) => Promise<void>;
  client: Pick<SupabaseClient, 'rpc'>;
  orderArgs: Record<string, unknown>;
  items: readonly {
    __baci_line_ordinal: number;
    assurance_fee: number;
    price: number;
    product_id?: string | null;
    quantity: number;
  }[];
  fees: readonly number[];
  currency: string;
  expectedTotal?: number | null;
  hasIncompatibleDiscount: boolean;
  merchantId: string;
  merchantSlug: string;
}) {
  const feeAmounts = [...fees, ...items.map((item) => item.assurance_fee)];
  if (
    items.some((item) => !isMajorAmountRepresentable(item.price, 'NGN')) ||
    feeAmounts.some((amount) => !isMajorAmountRepresentable(amount, 'NGN')) ||
    (typeof expectedTotal === 'number' &&
      !isMajorAmountRepresentable(expectedTotal, 'NGN'))
  ) {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_AMOUNT_INVALID',
        error: 'Bank card offer amounts must use whole kobo',
      },
      { status: 409 }
    );
  }
  if (currency !== 'NGN' || hasIncompatibleDiscount) {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_UNAVAILABLE',
        error: 'Bank card offer unavailable for this checkout',
      },
      { status: 409 }
    );
  }
  let quote: ReturnType<typeof quoteBankCardOffer> = null;
  try {
    quote = quoteBankCardOffer({
      offer,
      merchantId,
      now: Date.now(),
      items: items.map((item) => ({
        itemId: String(item.__baci_line_ordinal),
        productId: item.product_id ?? '',
        unitPriceKobo: Math.round(item.price * 100),
        quantity: item.quantity,
      })),
    });
  } catch (error) {
    logger.warn({
      message: 'Unable to quote bank card offer checkout',
      merchantId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_CART_INVALID',
        error: 'Check the items and quantities in your cart and try again',
      },
      { status: 409 }
    );
  }
  if (!quote) {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_UNAVAILABLE',
        error: 'Bank card offer unavailable for this checkout',
      },
      { status: 409 }
    );
  }
  const payableKobo =
    quote.productSubtotalKobo -
    quote.discountKobo +
    feeAmounts.reduce((kobo, amount) => kobo + Math.round(amount * 100), 0);
  if (
    typeof expectedTotal !== 'number' ||
    !Number.isSafeInteger(payableKobo) ||
    Math.round(expectedTotal * 100) !== payableKobo
  ) {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_TOTAL_MISMATCH',
        error: 'Confirm the updated bank card offer total and try again',
      },
      { status: 409 }
    );
  }
  const result = await createBankCardOfferCheckout({
    client,
    orderArgs: { ...orderArgs, p_checkout_request_hash: requestHash },
    quote,
    userId,
  });
  if (result.error?.message === 'bank_card_offer_paystack_unavailable') {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_UNAVAILABLE',
        error: 'Bank card offer checkout is unavailable',
      },
      { status: 409 }
    );
  }
  if (result.error?.message === 'checkout_idempotency_conflict') {
    return NextResponse.json(
      {
        code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
        error: 'This checkout key has already been used for a different order',
      },
      { status: 409 }
    );
  }
  if (result.error || !result.data) {
    logger.warn({
      message: 'Bank card offer checkout was rejected',
      merchantId,
      code: result.error?.code,
    });
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_ORDER_REJECTED',
        error: 'Unable to create this bank card offer order',
      },
      { status: 409 }
    );
  }
  const replayed = result.data.idempotency_replayed === true;
  try {
    await repairEffects(result.data, merchantSlug);
  } catch (error) {
    logger.error({
      message: 'Bank offer post-checkout effects failed',
      merchantId,
      orderId: result.data.id,
      error,
    });
  }
  return NextResponse.json(
    {
      order: result.data,
      ...(replayed ? { idempotency: { replayed: true } } : {}),
    },
    {
      status: replayed ? 200 : 201,
      headers: replayed ? { 'x-idempotency-replayed': 'true' } : undefined,
    }
  );
}
