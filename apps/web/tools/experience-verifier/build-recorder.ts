import type { Pool } from 'pg';
import { z } from 'zod';
import type { VerifierReceipt } from '@/lib/experience/local-build-supervisor-types';
import { productionOrigin } from '@/lib/experience/production-origins';
import { verifyVerifierDatabaseRole } from './database-role';

const receiptSchema = z.strictObject({
  merchantId: z.uuid(),
  jobId: z.uuid(),
  attemptNonce: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  hostOrigin: z.string().max(1000),
});

/** Private verifier process only; callers must independently qualify the build first. */
export async function createVerifierBuildRecorder(pool: Pool) {
  await verifyVerifierDatabaseRole(pool);
  return async (input: VerifierReceipt) => {
    const value = receiptSchema.parse(input);
    productionOrigin(value.hostOrigin);
    await pool.query(
      'INSERT INTO public.experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
      [
        value.merchantId,
        value.jobId,
        value.attemptNonce,
        value.buildDigest,
        value.receiptDigest,
        value.hostOrigin,
      ]
    );
  };
}
