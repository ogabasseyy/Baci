import { isDeepStrictEqual } from 'node:util';
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { redvaultProofContextSchema } from '@/schemas/redvault-proof-context';
import type { RedvaultOrderQuote } from './compute-redvault-order-quote';
import { createRedvaultDiscountProof } from './create-redvault-discount-proof';
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
    const result = await createRedvaultOrderDraft({
      client,
      draftArgs: {
        p_order: { ...order, discount_amount: quote.discountKobo / 100 },
        p_quote: quote,
      },
      createProof: (draft) => {
        const context = redvaultProofContextSchema.parse(draft.proofContext);
        const groups = context.groups.map((group) => ({
          ...group,
          members: group.members.map(
            ({ orderItemId: _orderItemId, ...member }) => member
          ),
        }));
        if (
          !isDeepStrictEqual(groups, quote.groups) ||
          context.discountKobo !== quote.discountKobo ||
          context.eligibleSubtotalKobo !== quote.eligibleSubtotalKobo ||
          context.productSubtotalKobo !== quote.productSubtotalKobo
        ) {
          throw new Error('redvault_snapshot_mismatch');
        }
        return createRedvaultDiscountProof({
          customerEmail: customerEmail.trim().toLowerCase(),
          groups: context.groups,
          merchantId,
          userId: userId ?? 'guest',
          orderId: draft.id,
          quotePayloadHash: draft.quotePayloadHash,
          quoteVersionId: draft.quoteVersionId,
          totals: context,
        }).proof;
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
