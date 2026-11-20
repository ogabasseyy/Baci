import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyCompiledCandidate } from '@/lib/experience/compiled-candidate';
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
  return async (input: VerifierReceipt, inputRenderer: unknown) => {
    const value = receiptSchema.parse(input);
    productionOrigin(value.hostOrigin);
    const renderer = verifyCompiledCandidate(inputRenderer);
    await pool.query(
      'SELECT experience_authorization.record_verified_renderer($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        value.merchantId,
        value.jobId,
        value.attemptNonce,
        value.buildDigest,
        value.receiptDigest,
        value.hostOrigin,
        JSON.stringify(renderer),
      ]
    );
  };
}
