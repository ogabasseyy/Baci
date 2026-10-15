import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { readAgenticSharedCartBinding } from '@/lib/agentic/checkout-completion-payloads';
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
