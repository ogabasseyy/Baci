import type { Pool } from 'pg';
import type { IndependentApprovalDependencies } from '@/lib/experience/independent-approval-verifier';
import { verifierApprovalRecord } from '@/schemas/experience-verification-records';
import { verifyVerifierDatabaseRole } from './database-role';

/** Verifier process only. Caller must independently establish the proof first. */
export async function createVerifierApprovalRecorder(pool: Pool) {
  await verifyVerifierDatabaseRole(pool);
  const record: IndependentApprovalDependencies['record'] = async (input) => {
    const value = verifierApprovalRecord.parse(input);
    const values = [
      value.approvalId,
      value.effectDigest,
      value.markerDigest,
      value.expiresAt,
    ];
    if (value.kind === 'draft') {
      await pool.query(
        "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,LEAST($4::timestamptz,statement_timestamp()+interval '5 minutes'))",
        values
      );
    } else {
      await pool.query(
        "INSERT INTO experience_authorization.lifecycle_checks(intent_id,kind,effect_digest,marker_digest,expires_at) VALUES($1,'render',$2,$3,LEAST($4::timestamptz,statement_timestamp()+interval '5 minutes'))",
        values
      );
    }
  };
  return record;
}
