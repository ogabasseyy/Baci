import type { Pool } from 'pg';
import { z } from 'zod';
import { digestBytes } from '@/lib/experience/manifest-digest';
import type { RecordedPrivateCapture } from '@/lib/experience/private-capture-service';
import { validateSemanticSnapshot } from '@/lib/experience/semantic-data';
import { snapshotKeyDigest } from '@/lib/experience/snapshot-key';
import { verifyVerifierDatabaseRole } from './database-role';

const id = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Private verifier worker only: this stores evidence; it does not verify its provenance. */
export async function createVerifierCaptureRecorder(pool: Pool) {
  await verifyVerifierDatabaseRole(pool);
  return async (capture: RecordedPrivateCapture) => {
    id.parse(capture.id);
    id.parse(capture.merchantId);
    id.parse(capture.buildId);
    digest.parse(capture.buildDigest);
    digest.parse(capture.keyDigest);
    digest.parse(capture.evidenceDigest);
    const { key, consumesCatalog, nodes } = capture.snapshot;
    if (
      key.build !== capture.buildDigest ||
      snapshotKeyDigest(key) !== capture.keyDigest ||
      typeof consumesCatalog !== 'boolean' ||
      (consumesCatalog && key.catalog === null) ||
      !(capture.bytes instanceof Uint8Array) ||
      capture.bytes.byteLength < 1 ||
      capture.bytes.byteLength > 2097152 ||
      digestBytes(capture.bytes) !== capture.evidenceDigest
    )
      throw Error('INVALID_CAPTURE');
    const safe = validateSemanticSnapshot({
      revision: capture.keyDigest,
      path: key.path,
      nodes,
    });
    await pool.query(
      'INSERT INTO public.experience_snapshots(id,merchant_id,build_id,build_digest,key_digest,snapshot_key,catalog_revision,consumes_catalog,nodes,evidence_digest,evidence_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        capture.id,
        capture.merchantId,
        capture.buildId,
        capture.buildDigest,
        capture.keyDigest,
        JSON.stringify(key),
        key.catalog,
        consumesCatalog,
        JSON.stringify(safe.nodes),
        capture.evidenceDigest,
        Buffer.from(capture.bytes),
      ]
    );
  };
}
