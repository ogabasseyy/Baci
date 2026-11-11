import type { SupabaseClient } from '@supabase/supabase-js';
import { digestBytes } from './manifest-digest';

type CaptureInput = {
  buildId: string;
  routeId: string;
  idempotencyKey: string;
};

/** State is bounded to the snapshot schema while binding the exact route and build. */
export function captureReplayState(input: CaptureInput) {
  const fingerprint = digestBytes(
    JSON.stringify([input.buildId, input.routeId])
  ).slice(0, 32);
  return `preview:${input.idempotencyKey}:${fingerprint}`;
}

/** Owner RLS read only. A previously used key cannot silently change its binding. */
export async function loadCaptureReplay(
  client: SupabaseClient,
  merchantId: string,
  input: CaptureInput
) {
  const result = await client
    .from('experience_snapshots')
    .select('id,build_id,build_digest,key_digest,snapshot_key')
    .eq('merchant_id', merchantId)
    .like('snapshot_key->>state', `preview:${input.idempotencyKey}%`)
    .limit(2);
  if (result.error || !result.data) throw Error('CAPTURE_REPLAY_UNAVAILABLE');
  if (result.data.length === 0) return null;
  if (result.data.length !== 1) throw Error('IDEMPOTENCY_CONFLICT');
  const row = result.data[0];
  const snapshot = row.snapshot_key;
  if (
    row.build_id !== input.buildId ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    snapshot.state !== captureReplayState(input)
  )
    throw Error('IDEMPOTENCY_CONFLICT');
  return row;
}

export function validateCaptureReplay(
  row: Awaited<ReturnType<typeof loadCaptureReplay>>,
  buildDigest: string,
  keyDigest: string
) {
  if (!row) return null;
  if (row.build_digest !== buildDigest || row.key_digest !== keyDigest)
    throw Error('IDEMPOTENCY_CONFLICT');
  return row.id;
}

export async function findCaptureReplay(
  client: SupabaseClient,
  merchantId: string,
  input: CaptureInput,
  buildDigest: string,
  keyDigest: string
) {
  return validateCaptureReplay(
    await loadCaptureReplay(client, merchantId, input),
    buildDigest,
    keyDigest
  );
}
