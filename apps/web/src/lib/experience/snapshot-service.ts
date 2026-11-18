import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateSemanticSnapshot } from '@/lib/experience/semantic-data';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import { digestBytes } from './manifest-digest';
import type {
  ExperienceSnapshot,
  ExperienceSnapshotKey,
} from './snapshot-freshness';
import { snapshotKeyDigest } from './snapshot-key';

interface VerifiedCapture {
  snapshot: ExperienceSnapshot;
  evidence: { bytes: Uint8Array; digest: string; mime: 'image/png' };
}
/** Installed only in the trusted verifier, with its restricted NOLOGIN-role client. */
export async function persistVerifiedSnapshot(
  verifier: SupabaseClient,
  input: { merchantId: string; buildId: string; capture: VerifiedCapture }
) {
  const { capture } = input;
  const keyDigest = snapshotKeyDigest(capture.snapshot.key);
  validateSemanticSnapshot({
    revision: capture.snapshot.key.catalog ?? 'non-catalog',
    path: capture.snapshot.key.path,
    nodes: capture.snapshot.nodes,
  });
  if (capture.snapshot.consumesCatalog && capture.snapshot.key.catalog === null)
    throw Error('CATALOG_UNAVAILABLE');
  if (
    capture.evidence.bytes.length > 2097152 ||
    capture.evidence.digest !== digestBytes(capture.evidence.bytes) ||
    capture.evidence.mime !== 'image/png'
  )
    throw Error('INVALID_EVIDENCE');
  const id = randomUUID();
  const result = await verifier.from('experience_snapshots').insert({
    id,
    merchant_id: input.merchantId,
    build_id: input.buildId,
    build_digest: capture.snapshot.key.build,
    key_digest: keyDigest,
    snapshot_key: capture.snapshot.key,
    catalog_revision: capture.snapshot.key.catalog,
    consumes_catalog: capture.snapshot.consumesCatalog,
    nodes: capture.snapshot.nodes,
    evidence_digest: capture.evidence.digest,
    evidence_bytes: `\\x${Buffer.from(capture.evidence.bytes).toString('hex')}`,
  });
  if (result.error) throw Error('SNAPSHOT_UNAVAILABLE');
  return {
    evidenceId: id,
    buildDigest: capture.snapshot.key.build,
    captureId: id,
    mime: 'image/png' as const,
    bytes: capture.evidence.bytes.length,
    ready: true,
  };
}
/** Owner requests a real isolated capture; neither caller nor source certifies it. */
export async function requestSemanticSnapshot(
  ctxInput: OwnerRequestContext,
  input: { buildId: string; key: ExperienceSnapshotKey },
  deps: {
    current: (
      merchantId: string,
      key: ExperienceSnapshotKey
    ) => Promise<ExperienceSnapshotKey | null>;
    capture: (
      ctx: OwnerRequestContext,
      buildId: string,
      key: ExperienceSnapshotKey
    ) => Promise<VerifiedCapture>;
    record: (input: {
      merchantId: string;
      buildId: string;
      capture: VerifiedCapture;
    }) => ReturnType<typeof persistVerifiedSnapshot>;
  }
) {
  const ctx = await requireExperienceOwner(ctxInput);
  snapshotKeyDigest(input.key);
  const build = await ctx.supabase
    .from('experience_builds')
    .select('id,build_digest')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', input.buildId)
    .maybeSingle();
  if (build.error || !build.data || build.data.build_digest !== input.key.build)
    throw Error('NOT_FOUND');
  const current = await deps.current(ctx.merchantId, input.key);
  if (!current || snapshotKeyDigest(current) !== snapshotKeyDigest(input.key))
    throw Error('SNAPSHOT_STALE');
  const capture = await deps.capture(ctx, input.buildId, current);
  if (snapshotKeyDigest(capture.snapshot.key) !== snapshotKeyDigest(current))
    throw Error('SNAPSHOT_STALE');
  const after = await deps.current(ctx.merchantId, current);
  if (!after || snapshotKeyDigest(after) !== snapshotKeyDigest(current))
    throw Error('SNAPSHOT_STALE');
  return deps.record({
    merchantId: ctx.merchantId,
    buildId: input.buildId,
    capture,
  });
}
export const requestVisualEvidence = requestSemanticSnapshot;
