import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { readAgenticSharedCartBinding } from '@/lib/agentic/checkout-completion-payloads';
import { finalizeAgenticPayOnDeliveryCheckout } from '@/lib/agentic/checkout-pay-on-delivery-finalize';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

/**
 * A bound shared-cart session submits with the preparing principal
 * from its server-side checkout-session record; the binding RPC
 * requires it and fails closed when it cannot be resolved here.
 */
export async function resolveAgenticSharedCartPrincipalId(input: {
  bootstrap: SupabaseClient;
  merchantId: string;
  metadata: unknown;
}): Promise<string | null> {
  const binding = readAgenticSharedCartBinding(input.metadata);
  if (!binding) return null;
  const { data } = await input.bootstrap
    .from('commerce_cart_checkout_sessions')
    .select('principal_id, merchant_id, cart_id')
    .eq('id', binding.checkout_session_id)
    .maybeSingle();
  if (
    data &&
    data.merchant_id === input.merchantId &&
    data.cart_id === binding.cart_id &&
    typeof data.principal_id === 'string' &&
    data.principal_id
  ) {
    return data.principal_id;
  }
  return null;
}

type PayOnDeliveryFinalizeInput = Parameters<
  typeof finalizeAgenticPayOnDeliveryCheckout
>[0];

/**
 * Pay-on-delivery completion branch: bound shared-cart sessions submit
 * with the preparing principal, exactly like the DVA path, so the
 * reviewed generation is revalidated and closed with order creation.
 */
export async function completeAgenticPayOnDelivery(
  input: Omit<PayOnDeliveryFinalizeInput, 'sharedCartPrincipalId'> & {
    bootstrap: SupabaseClient;
    payOnDeliveryEnabled: boolean;
    respond: (body: unknown, status: number) => Promise<NextResponse>;
  }
): Promise<NextResponse> {
  if (!input.payOnDeliveryEnabled) {
    return input.respond(
      { error: 'Pay on delivery is not enabled for this merchant' },
      403
    );
  }
  const sharedCartPrincipalId = await resolveAgenticSharedCartPrincipalId({
    bootstrap: input.bootstrap,
    merchantId: input.merchantId,
    metadata: input.metadata,
  });
  return finalizeAgenticPayOnDeliveryCheckout({
    ...input,
    sharedCartPrincipalId,
  });
}

/** Logs and stores the generic 500 for an unexpected completion failure. */
export async function agenticCompleteFailureResponse(input: {
  error: unknown;
  respondWithIdempotency:
    | ((response: unknown, status: number) => Promise<NextResponse>)
    | null;
  sessionId: string;
}): Promise<NextResponse> {
  const body = { error: 'Internal Server Error' };
  logger.error({
    message: 'Agentic checkout complete failed',
    error: sanitizeForLog(input.error),
    sessionId: input.sessionId,
  });
  if (input.respondWithIdempotency) {
    try {
      return await input.respondWithIdempotency(body, 500);
    } catch {
      return NextResponse.json(body, { status: 500 });
    }
  }
  return NextResponse.json(body, { status: 500 });
}
