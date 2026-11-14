import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyVerifierDatabaseRole } from './database-role';

const schema = z.strictObject({
  receiptId: z.uuid(),
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  markerDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Restricted verifier only, after independently observing public delivery. */
export async function createVerifierPublicRecorder(pool: Pool) {
  await verifyVerifierDatabaseRole(pool);
  return async (input: z.infer<typeof schema>) => {
    const proof = schema.parse(input);
    await pool.query('SELECT public.experience_record_public_check($1,$2,$3)', [
      proof.receiptId,
      proof.effectDigest,
      proof.markerDigest,
    ]);
  };
}
