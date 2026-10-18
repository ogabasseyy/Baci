import type { SupabaseClient } from '@supabase/supabase-js';
import { hashIdempotencyRequest } from '@/lib/agentic/idempotency-hash';
import { logger } from '@/lib/logger';
import { reclaimStaleIdempotencyReservation } from './idempotency-expiry';
import {
  adoptVerifiedLegacyIdempotencyRecord,
  type LegacyIdempotencyRecord,
} from './idempotency-legacy';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const POSTGRES_UNIQUE_VIOLATION = '23505';
export const IDEMPOTENCY_PARAMETER_MISMATCH_ERROR =
  'Idempotency key reused with different request parameters';
export const IDEMPOTENCY_REQUEST_IN_PROGRESS_ERROR =
  'Idempotency request in progress';
export const IDEMPOTENCY_RESERVATION_FAILED_ERROR =
  'Idempotency reservation failed';
export const IDEMPOTENCY_TRANSIENT_LOOKUP_ERROR =
  'Idempotency transient lookup error';

interface IdempotencyRecord {
  request_hash?: unknown;
  response_body?: unknown;
  status_code?: unknown;
  updated_at?: unknown;
}

type ExistingIdempotencyRecordResult =
  | { ok: true; record: IdempotencyRecord | null }
  | { error: unknown; ok: false };

export type IdempotencyReservationResult =
  | { ok: true; state: 'reserved' }
  | {
      ok: true;
      requestHash: string;
      response: unknown;
      state: 'replay';
      status: number;
    }
  | {
      error:
        | typeof IDEMPOTENCY_PARAMETER_MISMATCH_ERROR
        | typeof IDEMPOTENCY_REQUEST_IN_PROGRESS_ERROR
        | typeof IDEMPOTENCY_TRANSIENT_LOOKUP_ERROR;
      ok: false;
    }
  | { error: typeof IDEMPOTENCY_RESERVATION_FAILED_ERROR; ok: false };

interface IdempotencyScopeContext {
  agentId: string;
  key: string;
  merchantId: string;
  route: string;
  supabase: SupabaseClient;
}

export async function reserveAgenticIdempotencyKey(input: {
  agentId?: string | null;
  apiVersion: string;
  body: string;
  key: string;
  merchantId: string;
  method: string;
  now?: Date;
  pathname: string;
  route: string;
  supabase: SupabaseClient;
}): Promise<IdempotencyReservationResult> {
  const { key, merchantId, now = new Date(), route, supabase } = input;
  const callerScope = input.agentId ?? '';
  const requestHash = hashIdempotencyRequest(input);

  const { error: purgeError } = await supabase
    .from('agentic_idempotency_records')
    .delete()
    .eq('merchant_id', merchantId)
    .lt('expires_at', now.toISOString());
  if (purgeError) {
    logger.warn({
      message: 'Failed to purge expired agentic idempotency records',
      error: purgeError,
      merchantId,
      route,
    });
  }

  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  const baseScope = { key, merchantId, route, supabase };
  if (callerScope !== '') {
    const legacy = await getExistingIdempotencyRecord({
      ...baseScope,
      agentId: '',
    });
    if (!legacy.ok) {
      logger.error({
        message: 'Failed to load legacy agentic idempotency record',
        error: legacy.error,
        merchantId,
        route,
      });
      return { error: IDEMPOTENCY_RESERVATION_FAILED_ERROR, ok: false };
    }
    if (legacy.record) {
      const adopted = await adoptVerifiedLegacyIdempotencyRecord({
        callerScope,
        key,
        merchantId,
        record: legacy.record as LegacyIdempotencyRecord,
        requestHash,
        route,
        supabase,
      });
      if (adopted.kind === 'error') {
        return {
          error:
            adopted.reason === 'mismatch'
              ? IDEMPOTENCY_PARAMETER_MISMATCH_ERROR
              : IDEMPOTENCY_RESERVATION_FAILED_ERROR,
          ok: false,
        };
      }
      if (adopted.kind === 'replay') {
        return {
          ok: true,
          requestHash,
          response: adopted.response,
          state: 'replay',
          status: adopted.status,
        };
      }
      if (adopted.kind === 'in_progress') {
        return resolveExistingIdempotencyRecord(
          { ...baseScope, agentId: '' },
          { callerScope, expiresAt, now, record: legacy.record, requestHash }
        );
      }
    }
  }

  const { error } = await supabase
    .from('agentic_idempotency_records')
    .insert({
      agent_id: callerScope,
      expires_at: expiresAt,
      idempotency_key: key,
      merchant_id: merchantId,
      request_hash: requestHash,
      route,
    })
    .select('id')
    .maybeSingle();

  if (!error) return { ok: true, state: 'reserved' };
  if (error.code !== POSTGRES_UNIQUE_VIOLATION) {
    return { error: IDEMPOTENCY_RESERVATION_FAILED_ERROR, ok: false };
  }

  const scopedContext = { ...baseScope, agentId: callerScope };
  const existing = await getExistingIdempotencyRecord(scopedContext);
  if (!existing.ok) {
    logger.error({
      message: 'Failed to load existing agentic idempotency record',
      error: existing.error,
      merchantId,
      route,
    });
    return { error: IDEMPOTENCY_RESERVATION_FAILED_ERROR, ok: false };
  }
  if (!existing.record) {
    return { error: IDEMPOTENCY_TRANSIENT_LOOKUP_ERROR, ok: false };
  }
  return resolveExistingIdempotencyRecord(scopedContext, {
    callerScope,
    expiresAt,
    now,
    record: existing.record,
    requestHash,
  });
}

async function resolveExistingIdempotencyRecord(
  scope: IdempotencyScopeContext,
  input: {
    callerScope: string;
    expiresAt: string;
    now: Date;
    record: IdempotencyRecord;
    requestHash: string;
  }
): Promise<IdempotencyReservationResult> {
  const { callerScope, expiresAt, now, record, requestHash } = input;
  if (record.request_hash !== requestHash) {
    return { error: IDEMPOTENCY_PARAMETER_MISMATCH_ERROR, ok: false };
  }
  if (typeof record.status_code !== 'number') {
    const reclaimed = await reclaimStaleIdempotencyReservation(scope, {
      claimedAgentId: callerScope,
      expiresAt,
      now,
      record,
      requestHash,
    });
    if (reclaimed.ok) return { ok: true, state: 'reserved' };
    if (reclaimed.error) {
      return { error: IDEMPOTENCY_RESERVATION_FAILED_ERROR, ok: false };
    }
    return { error: IDEMPOTENCY_REQUEST_IN_PROGRESS_ERROR, ok: false };
  }
  return {
    ok: true,
    requestHash,
    response: record.response_body,
    state: 'replay',
    status: record.status_code,
  };
}

export async function storeAgenticIdempotencyResponse(input: {
  agentId?: string | null;
  key: string;
  merchantId: string;
  response: unknown;
  route: string;
  status: number;
  supabase: SupabaseClient;
}) {
  const { data, error } = await input.supabase
    .from('agentic_idempotency_records')
    .update({
      response_body: input.response,
      status_code: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('route', input.route)
    .eq('idempotency_key', input.key)
    .eq('merchant_id', input.merchantId)
    .eq('agent_id', input.agentId ?? '')
    .select('id')
    .maybeSingle();

  if (error) return { error, ok: false };
  if (!data) {
    return {
      error: new Error('Agentic idempotency record not found'),
      ok: false,
    };
  }
  return { error: null, ok: true };
}

async function getExistingIdempotencyRecord(
  scope: IdempotencyScopeContext
): Promise<ExistingIdempotencyRecordResult> {
  const { data, error } = await scope.supabase
    .from('agentic_idempotency_records')
    .select('request_hash, response_body, status_code, updated_at')
    .eq('route', scope.route)
    .eq('idempotency_key', scope.key)
    .eq('merchant_id', scope.merchantId)
    .eq('agent_id', scope.agentId)
    .maybeSingle();
  if (error) return { error, ok: false };
  return { ok: true, record: data as IdempotencyRecord | null };
}
