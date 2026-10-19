import type { SupabaseClient } from '@supabase/supabase-js';
import { readAgenticSharedCartBinding } from '@/lib/agentic/checkout-completion-payloads';
import { compensatePayOnDeliveryFinalizationFailure } from '@/lib/agentic/checkout-pay-on-delivery-compensation';
import type { AgenticMetadata } from '@/lib/agentic/checkout-storage';
import {
  buildPersistedAgenticIdempotencyResponse,
  persistAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency-response-storage';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

export async function handlePayOnDeliverySessionCompletionFailure({
  agentId,
  finalizationClaim,
  idempotencyKey,
  merchantId,
  metadata,
  orderId,
  requestId,
  route,
  sessionId,
  successResponse,
  supabase,
  updateError,
}: {
  agentId?: string | null;
  finalizationClaim: string;
  idempotencyKey: string;
  merchantId: string;
  metadata: AgenticMetadata;
  orderId: string;
  requestId: string;
  route: string;
  sessionId: string;
  successResponse: unknown;
  supabase: SupabaseClient;
  updateError: unknown;
}) {
  const failureBody = { error: 'Database error' };
  const failurePersisted = await persistAgenticIdempotencyResponse({
    agentId,
    idempotencyKey,
    merchantId,
    requestId,
    response: failureBody,
    route,
    status: 500,
    supabase,
  });

  logger.error({
    error: {
      idempotencyFailure: failurePersisted.ok
        ? null
        : sanitizeForLog(failurePersisted.error),
      updateError: sanitizeForLog(updateError),
    },
    message: 'Pay-on-delivery checkout session completion failed',
    orderId: sanitizeForLog(orderId),
    sessionId: sanitizeForLog(sessionId),
  });

  if (!failurePersisted.ok) {
    return buildPersistedAgenticIdempotencyResponse({
      idempotencyKey,
      merchantId,
      requestId,
      response: successResponse,
      route,
      status: 200,
    });
  }

  await compensatePayOnDeliveryFinalizationFailure({
    bound: Boolean(readAgenticSharedCartBinding(metadata)),
    finalizationClaim,
    merchantId,
    metadata,
    orderError: updateError,
    orderId,
    sessionId,
    supabase,
  });

  return buildPersistedAgenticIdempotencyResponse({
    idempotencyKey,
    merchantId,
    requestId,
    response: failureBody,
    route,
    status: 500,
  });
}
