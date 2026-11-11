import type { SupabaseClient } from '@supabase/supabase-js';
import {
  experienceCapturedEvidence,
  experienceVerifierDigest,
} from '@/schemas/experience-captured-evidence';
import { loadDraftApproval } from './approval-service';
import { digestBytes } from './manifest-digest';
import type { OwnerLifecycleVerification } from './owner-lifecycle-runtime';
import { loadLifecycleApproval } from './publication-service';

export interface IndependentApprovalDependencies {
  capture(
    client: SupabaseClient,
    binding: {
      approvalId: string;
      kind: 'draft' | 'lifecycle';
      buildId?: string;
      effectDigest: string;
    }
  ): Promise<unknown>;
  /** Restricted verifier connection; no business/source client or service-role factory. */
  record(input: {
    approvalId: string;
    kind: 'draft' | 'lifecycle';
    effectDigest: string;
    markerDigest: string;
  }): Promise<void>;
  verifyPublic(
    client: SupabaseClient,
    receipt: Record<string, unknown>
  ): Promise<void>;
}
export function createIndependentApprovalVerifier(
  deps: IndependentApprovalDependencies
): OwnerLifecycleVerification {
  return {
    attest: async (client, approvalId, kind) => {
      const approval =
        kind === 'draft'
          ? await loadDraftApproval(client, approvalId)
          : await loadLifecycleApproval(client, approvalId);
      if (approval.status !== 'confirmation-required') return;
      const effectDigest = experienceVerifierDigest.parse(
        approval.effectDigest
      );
      const buildId =
        typeof approval.buildId === 'string' ? approval.buildId : undefined;
      const evidence = experienceCapturedEvidence.parse(
        await deps.capture(client, { approvalId, kind, buildId, effectDigest })
      );
      if (
        evidence.effectDigest !== effectDigest ||
        (buildId && evidence.buildId !== buildId)
      )
        throw Error('APPROVAL_MISMATCH');
      const current =
        kind === 'draft'
          ? await loadDraftApproval(client, approvalId)
          : await loadLifecycleApproval(client, approvalId);
      if (
        current.status !== 'confirmation-required' ||
        current.effectDigest !== effectDigest
      )
        throw Error('APPROVAL_MISMATCH');
      await deps.record({
        approvalId,
        kind,
        effectDigest,
        markerDigest: digestBytes(JSON.stringify(evidence)),
      });
    },
    verifyCommitted: deps.verifyPublic,
  };
}
