import type { Pool } from 'pg';
import {
  type VerifierPublicRecord,
  verifierPublicRecord,
} from '@/schemas/experience-verification-records';
import { verifyVerifierDatabaseRole } from './database-role';

/** Restricted verifier only, after independently observing public delivery. */
export async function createVerifierPublicRecorder(pool: Pool) {
  await verifyVerifierDatabaseRole(pool);
  return async (input: VerifierPublicRecord) => {
    const proof = verifierPublicRecord.parse(input);
    await pool.query('SELECT public.experience_record_public_check($1,$2,$3)', [
      proof.receiptId,
      proof.effectDigest,
      proof.markerDigest,
    ]);
  };
}
