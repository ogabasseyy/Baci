import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { storeAgenticIdempotencyResponse } from '@/lib/agentic/idempotency';
import { logger } from '@/lib/logger';

function jsonResponse(
  response: unknown,
  init: ResponseInit,
  context: {
    idempotencyKey: string;
    merchantId: string;
    requestId: string;
    route: string;
  }
) {
  try {
    return NextResponse.json(response, init);
  } catch (error) {
    logger.error({
      message: 'Failed to serialize agentic idempotency response',
      error,
      ...context,
    });
    return NextResponse.json(
      { error: 'Idempotency response serialization failed' },
      { ...init, status: 500 }
    );
  }
}

function validateIdempotencyStatus(status: number): number {
  return Number.isInteger(status) && status >= 200 && status <= 599
    ? status
    : 500;
}

/**
 * Persists an idempotent agentic response for future replay.
 *
 * Returns `{ ok: true }` on success. On failure, returns the error so callers
 * can decide how to react (e.g. avoid mutating side-effect state that would
 * make the operation non-recoverable on retry).
 *
 * The response payload must be JSON-serializable because it is stored verbatim
 * in the agentic_idempotency_records table.
 */
export async function persistAgenticIdempotencyResponse({
  agentId,
  idempotencyKey,
  merchantId,
  requestId,
  response,
  route,
  status,
  supabase,
}: {
  agentId?: string | null;
  idempotencyKey: string;
  merchantId: string;
  requestId: string;
  response: unknown;
  route: string;
  status: number;
  supabase: SupabaseClient;
}): Promise<{ error: unknown; ok: false } | { ok: true }> {
  const validatedStatus = validateIdempotencyStatus(status);
  let stored: { error: unknown; ok: boolean };
  try {
    stored = await storeAgenticIdempotencyResponse({
      agentId,
      key: idempotencyKey,
      merchantId,
      response,
      route,
      status: validatedStatus,
      supabase,
    });
  } catch (error) {
    stored = { error, ok: false };
  }

  if (!stored.ok) {
    logger.error({
      message: 'Failed to store agentic idempotency response',
      error: stored.error,
      idempotencyKey,
      merchantId,
      requestId,
      route,
    });
    return { error: stored.error, ok: false };
  }

  return { ok: true };
}

/**
 * Stores and returns an idempotent JSON response for agentic mutations.
 *
 * The response payload must be JSON-serializable because it is both returned
 * through NextResponse.json and stored for future idempotency replays.
 */
export async function buildStoredAgenticIdempotencyResponse({
  agentId,
  idempotencyKey,
  merchantId,
  requestId,
  response,
  route,
  status,
  storageFailureResponse,
  supabase,
}: {
  agentId?: string | null;
  idempotencyKey: string;
  merchantId: string;
  requestId: string;
  response: unknown;
  route: string;
  status: number;
  storageFailureResponse?: Record<string, unknown>;
  supabase: SupabaseClient;
}): Promise<NextResponse> {
  const headers = {
    'idempotency-key': idempotencyKey,
    'request-id': requestId,
  };
  const logContext = { idempotencyKey, merchantId, requestId, route };
  const validatedStatus = validateIdempotencyStatus(status);
  const stored = await persistAgenticIdempotencyResponse({
    agentId,
    idempotencyKey,
    merchantId,
    requestId,
    response,
    route,
    status: validatedStatus,
    supabase,
  });

  if (!stored.ok) {
    const warningHeaders = {
      ...headers,
      'x-idempotency-warning': 'response-not-stored',
    };
    return jsonResponse(
      storageFailureResponse ?? {
        error: 'Idempotency response storage failed',
      },
      { headers: warningHeaders, status: 503 },
      logContext
    );
  }

  return jsonResponse(
    response,
    { headers, status: validatedStatus },
    logContext
  );
}

/**
 * Builds a NextResponse for an idempotent agentic mutation whose response body
 * has already been persisted via {@link persistAgenticIdempotencyResponse}.
 *
 * Use this in flows that must persist the response BEFORE performing a
 * non-recoverable side effect (e.g. flipping checkout_sessions.status to
 * 'completed'), so the storage call can fail-fast and let the client retry.
 */
export function buildPersistedAgenticIdempotencyResponse({
  idempotencyKey,
  merchantId,
  requestId,
  response,
  route,
  status,
}: {
  idempotencyKey: string;
  merchantId: string;
  requestId: string;
  response: unknown;
  route: string;
  status: number;
}): NextResponse {
  const headers = {
    'idempotency-key': idempotencyKey,
    'request-id': requestId,
  };
  return jsonResponse(
    response,
    { headers, status: validateIdempotencyStatus(status) },
    { idempotencyKey, merchantId, requestId, route }
  );
}
