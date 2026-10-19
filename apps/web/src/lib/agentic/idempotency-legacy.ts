import type { SupabaseClient } from '@supabase/supabase-js';

export interface LegacyIdempotencyRecord {
  request_hash: string;
  response_body: unknown;
  status_code: number | null;
  updated_at?: string | null;
}

function getResponseOwnerAgentId(responseBody: unknown): string | null {
  if (!responseBody || typeof responseBody !== 'object') return null;
  const record = responseBody as Record<string, unknown>;
  if (typeof record.agent_id === 'string' && record.agent_id.trim() !== '') {
    return record.agent_id.trim();
  }
  if (typeof record.agentId === 'string' && record.agentId.trim() !== '') {
    return record.agentId.trim();
  }
  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object') {
    const agentic = (metadata as Record<string, unknown>).agentic;
    if (agentic && typeof agentic === 'object') {
      const agentId = (agentic as Record<string, unknown>).agent_id;
      if (typeof agentId === 'string' && agentId.trim() !== '') {
        return agentId.trim();
      }
    }
  }
  return null;
}

export async function verifyLegacyIdempotencyOwnership(input: {
  callerScope: string;
  key: string;
  merchantId: string;
  record: LegacyIdempotencyRecord;
  route: string;
  supabase: SupabaseClient;
}): Promise<{ error?: unknown; verified: boolean }> {
  const { callerScope, key, merchantId, record, route, supabase } = input;
  const responseOwner = getResponseOwnerAgentId(record.response_body);
  if (responseOwner !== null) {
    return { verified: responseOwner === callerScope };
  }

  const { data, error } = await supabase
    .from('agentic_request_records')
    .select('agent_id')
    .eq('merchant_id', merchantId)
    .eq('route', route)
    .eq('idempotency_key', key)
    .limit(2);

  if (error) {
    return { error, verified: false };
  }

  const rows = Array.isArray(data)
    ? (data as Array<{ agent_id?: string | null }>)
    : [];
  if (rows.length === 0) {
    return { verified: false };
  }

  return {
    verified: rows.every((row) => row.agent_id === callerScope),
  };
}

export async function claimCompletedLegacyIdempotencyRecord(input: {
  callerScope: string;
  key: string;
  merchantId: string;
  requestHash: string;
  route: string;
  statusCode: number;
  supabase: SupabaseClient;
}): Promise<{
  error?: unknown;
  record: LegacyIdempotencyRecord | null;
}> {
  const {
    callerScope,
    key,
    merchantId,
    requestHash,
    route,
    statusCode,
    supabase,
  } = input;
  const { data, error } = await supabase
    .from('agentic_idempotency_records')
    .update({ agent_id: callerScope })
    .eq('route', route)
    .eq('idempotency_key', key)
    .eq('merchant_id', merchantId)
    .eq('agent_id', '')
    .eq('request_hash', requestHash)
    .eq('status_code', statusCode)
    .select('request_hash, response_body, status_code, updated_at')
    .maybeSingle();

  if (error) {
    return { error, record: null };
  }
  return { record: (data as LegacyIdempotencyRecord | null) ?? null };
}

export async function adoptVerifiedLegacyIdempotencyRecord(input: {
  callerScope: string;
  key: string;
  merchantId: string;
  record: LegacyIdempotencyRecord;
  requestHash: string;
  route: string;
  supabase: SupabaseClient;
}): Promise<
  | { kind: 'error'; reason: 'failed' | 'mismatch' }
  | { kind: 'in_progress' }
  | { kind: 'replay'; response: unknown; status: number }
  | { kind: 'unowned' }
> {
  const { callerScope, key, merchantId, record, requestHash, route, supabase } =
    input;
  const ownership = await verifyLegacyIdempotencyOwnership({
    callerScope,
    key,
    merchantId,
    record,
    route,
    supabase,
  });
  if (ownership.error) {
    return { kind: 'error', reason: 'failed' };
  }
  if (!ownership.verified) {
    return { kind: 'unowned' };
  }
  if (record.request_hash !== requestHash) {
    return { kind: 'error', reason: 'mismatch' };
  }
  if (typeof record.status_code !== 'number') {
    return { kind: 'in_progress' };
  }
  const claimed = await claimCompletedLegacyIdempotencyRecord({
    callerScope,
    key,
    merchantId,
    requestHash,
    route,
    statusCode: record.status_code,
    supabase,
  });
  if (claimed.error) {
    return { kind: 'error', reason: 'failed' };
  }
  if (claimed.record && typeof claimed.record.status_code === 'number') {
    return {
      kind: 'replay',
      response: claimed.record.response_body,
      status: claimed.record.status_code,
    };
  }
  return { kind: 'unowned' };
}
