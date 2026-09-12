import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createQuizRpcServerProof } from '@/lib/quiz-proof';
import type { RedvaultOrderQuote } from './compute-redvault-order-quote';
import { createRedvaultOrderDraft } from './redvault-order-draft';

export async function createRedvaultCheckoutResponse({
  client,
  orderRpcArgs,
  quote,
  customerEmail,
  merchantId,
  userId,
}: {
  client: SupabaseClient;
  orderRpcArgs: Record<string, unknown>;
  quote: RedvaultOrderQuote;
  customerEmail: string;
  merchantId: string;
  userId: string | null;
}) {
  try {
    const order = Object.fromEntries(
      Object.entries(orderRpcArgs).map(([key, value]) => [
        key.replace(/^p_/, ''),
        value,
      ])
    );
    const authoritativeOrder: Record<string, unknown> = JSON.parse(
      JSON.stringify({
        ...order,
        customer_email: customerEmail.trim().toLowerCase(),
        discount_amount: quote.discountKobo / 100,
        expected_total: null,
      })
    );
    const result = await createRedvaultOrderDraft({
      client,
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
    return NextResponse.json(
      {
        order: result.summary.order,
        redvault: {
          quote: result.summary.quote,
          status: 'pending',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
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
