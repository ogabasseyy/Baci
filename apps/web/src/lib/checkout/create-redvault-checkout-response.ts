import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sharedCartBindingFailure } from '@/lib/cart/order-route-binding';
import { createQuizRpcServerProof } from '@/lib/quiz-proof';
import type { RedvaultOrderQuote } from './compute-redvault-order-quote';
import { createRedvaultOrderDraft } from './redvault-order-draft';
import {
  RedvaultCartBindingError,
  type RedvaultSharedCart,
} from './redvault-shared-cart-binding';

export async function createRedvaultCheckoutResponse({
  client,
  orderRpcArgs,
  quote,
  customerEmail,
  merchantId,
  userId,
  sharedCart,
}: {
  client: SupabaseClient;
  orderRpcArgs: Record<string, unknown>;
  quote: RedvaultOrderQuote;
  customerEmail: string;
  merchantId: string;
  userId: string | null;
  sharedCart?: RedvaultSharedCart;
}) {
  try {
    const order = Object.fromEntries(
      Object.entries(orderRpcArgs).map(([key, value]) => [
        key.replace(/^p_/, ''),
        value,
      ])
    );
    const items = Array.isArray(order.items)
      ? order.items.map((item, index) => ({
          ...(item as Record<string, unknown>),
          condition: quote.lines[index]?.condition ?? null,
          variant_attributes: quote.lines[index]?.variantAttributes ?? {},
        }))
      : order.items;
    const authoritativeOrder: Record<string, unknown> = JSON.parse(
      JSON.stringify({
        ...order,
        customer_email: customerEmail.trim().toLowerCase(),
        discount_amount: quote.discountKobo / 100,
        expected_total: null,
        items,
      })
    );
    const result = await createRedvaultOrderDraft({
      client,
      sharedCart,
      orderArgs: orderRpcArgs,
      draftArgs: {
        p_order: authoritativeOrder,
        p_quote: quote,
        p_route_proof: createQuizRpcServerProof({
          action: 'storefront_redvault_order_create',
          payload: { order: authoritativeOrder, quote },
          subjectId: merchantId,
          userId: userId ?? 'guest',
        }),
      },
    });
    // Mirror the ordinary order path: a retried checkout key replays the
    // existing draft, and the caller needs the replay marked (body +
    // header + 200) so it does not emit another order_created event.
    const idempotencyReplayed = result.replayed === true;
    return NextResponse.json(
      {
        order: result.summary.order,
        redvault: {
          quote: result.summary.quote,
          status: 'pending',
        },
        ...(idempotencyReplayed ? { idempotency: { replayed: true } } : {}),
      },
      {
        headers: idempotencyReplayed
          ? { 'x-idempotency-replayed': 'true' }
          : undefined,
        status: idempotencyReplayed ? 200 : 201,
      }
    );
  } catch (error) {
    if (error instanceof RedvaultCartBindingError) {
      return sharedCartBindingFailure(error.code);
    }
    const message = error instanceof Error ? error.message : '';
    if (
      message === 'checkout_idempotency_conflict' ||
      message === 'order_not_reusable'
    ) {
      return NextResponse.json(
        {
          code:
            message === 'checkout_idempotency_conflict'
              ? 'CHECKOUT_IDEMPOTENCY_CONFLICT'
              : 'CHECKOUT_ORDER_NOT_REUSABLE',
          error:
            'This UBA checkout cannot be reused. Please start checkout again.',
        },
        { status: 409 }
      );
    }
    const domainError = /^redvault_[a-z0-9_]+$/.test(message);
    if (!domainError) {
      console.error('REDVAULT order creation failed');
    }
    return NextResponse.json(
      {
        code:
          message === 'redvault_disabled'
            ? 'REDVAULT_DISABLED'
            : message === 'redvault_commercial_terms_missing'
              ? 'REDVAULT_COMMERCIAL_TERMS_MISSING'
              : domainError
                ? 'REDVAULT_ORDER_REJECTED'
                : 'REDVAULT_ORDER_FAILED',
        error: 'Unable to create REDVAULT order',
      },
      { status: domainError ? 409 : 500 }
    );
  }
}
