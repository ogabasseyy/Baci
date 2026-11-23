import type { SupabaseClient } from '@supabase/supabase-js';
import { digestBytes } from './manifest-digest';

type CaptureInput = {
  buildId: string;
  routeId: string;
  idempotencyKey: string;
};

/** Scope only verifier-owned retries to server-computed snapshot freshness. */
export function approvalSnapshotReplayKey(
  approvalKey: string,
  snapshotDigest: string
) {
  const hex = digestBytes(
    JSON.stringify([
      'baci-approval-snapshot-replay/v1',
      approvalKey,
      snapshotDigest,
    ])
  );
  // RFC 9562 custom UUID with a deterministic SHA-256 payload.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** State is bounded to the snapshot schema while binding the exact route and build. */
export function captureReplayState(input: CaptureInput) {
  const fingerprint = digestBytes(
    JSON.stringify([input.buildId, input.routeId])
  ).slice(0, 32);
  return `preview:${input.idempotencyKey}:${fingerprint}`;
}

/** Owner RLS read. Callers validate the retry key as a UUID before using this prefix. */
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
