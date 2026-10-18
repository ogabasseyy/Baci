import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export const IDEMPOTENCY_IN_PROGRESS_TTL_MS = 2 * 60 * 1000;

export function isStaleInProgressReservation(
  record: { updated_at?: unknown },
  now: Date
): boolean {
  if (typeof record.updated_at !== 'string') {
    return false;
  }

  const updatedAt = new Date(record.updated_at);
  if (!Number.isFinite(updatedAt.getTime())) {
    return false;
  }

  return now.getTime() - updatedAt.getTime() >= IDEMPOTENCY_IN_PROGRESS_TTL_MS;
}

export async function reclaimStaleIdempotencyReservation(
  scope: {
    agentId: string;
    key: string;
    merchantId: string;
    route: string;
    supabase: SupabaseClient;
  },
  input: {
    claimedAgentId: string;
    expiresAt: string;
    now: Date;
    record: { updated_at?: unknown };
    requestHash: string;
  }
): Promise<{ error?: unknown; ok: boolean }> {
  if (!isStaleInProgressReservation(input.record, input.now)) {
    return { ok: false };
  }
  const staleBefore = new Date(
    input.now.getTime() - IDEMPOTENCY_IN_PROGRESS_TTL_MS
  ).toISOString();
  const { data, error } = await scope.supabase
    .from('agentic_idempotency_records')
    .update({
      ...(input.claimedAgentId !== scope.agentId
        ? { agent_id: input.claimedAgentId }
        : {}),
      expires_at: input.expiresAt,
      request_hash: input.requestHash,
      response_body: null,
      status_code: null,
      updated_at: input.now.toISOString(),
    })
    .eq('route', scope.route)
    .eq('idempotency_key', scope.key)
    .eq('merchant_id', scope.merchantId)
    .eq('agent_id', scope.agentId)
    .eq('request_hash', input.requestHash)
    .is('status_code', null)
    .lt('updated_at', staleBefore)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.warn({
      message: 'Failed to reclaim stale agentic idempotency reservation',
      error,
      merchantId: scope.merchantId,
      route: scope.route,
    });
    return { error, ok: false };
  }
  return { ok: !!data };
}
