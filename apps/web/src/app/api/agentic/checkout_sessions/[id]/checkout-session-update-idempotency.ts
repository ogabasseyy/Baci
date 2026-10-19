import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { getAgenticIdempotencyErrorStatus } from '@/lib/agentic/idempotency-response';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';

export const CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE =
  'checkout_sessions.update';

export type CheckoutSessionUpdateIdempotency =
  | { kind: 'failure'; response: NextResponse }
  | { kind: 'replay'; response: NextResponse }
  | {
      kind: 'reserved';
      respond: (response: unknown, status: number) => Promise<NextResponse>;
    };

/**
 * Caller-scoped idempotency reservation for checkout-session updates:
 * reserves the key, short-circuits replays with the stored response,
 * and returns the responder that persists every later reply.
 */
export async function reserveCheckoutSessionUpdateIdempotency(input: {
  agentId: string | null;
  apiVersion: string;
  idempotencyKey: string;
  merchantId: string;
  method: string;
  pathname: string;
  rawBody: string;
  requestId: string;
  supabase: SupabaseClient;
}): Promise<CheckoutSessionUpdateIdempotency> {
  const idempotency = await reserveAgenticIdempotencyKey({
    agentId: input.agentId,
    apiVersion: input.apiVersion,
    body: input.rawBody,
    key: input.idempotencyKey,
    merchantId: input.merchantId,
    method: input.method,
    pathname: input.pathname,
    route: CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE,
    supabase: input.supabase,
  });
  if (!idempotency.ok) {
    return {
      kind: 'failure',
      response: NextResponse.json(
        { error: idempotency.error },
        { status: getAgenticIdempotencyErrorStatus(idempotency.error) }
      ),
    };
  }
  if (idempotency.state === 'replay') {
    return {
      kind: 'replay',
      response: NextResponse.json(idempotency.response, {
        status: idempotency.status,
        headers: {
          'idempotency-key': input.idempotencyKey,
          'request-id': input.requestId,
        },
      }),
    };
  }
  return {
    kind: 'reserved',
    respond: (response: unknown, status: number) =>
      buildStoredAgenticIdempotencyResponse({
        agentId: input.agentId,
        idempotencyKey: input.idempotencyKey,
        merchantId: input.merchantId,
        requestId: input.requestId,
        response,
        route: CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE,
        status,
        storageFailureResponse: { error: 'Internal Server Error' },
        supabase: input.supabase,
      }),
  };
}
