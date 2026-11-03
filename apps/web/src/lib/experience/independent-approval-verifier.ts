import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadDraftApproval } from './approval-service';
import { digestBytes } from './manifest-digest';
import type { OwnerLifecycleVerification } from './owner-lifecycle-runtime';
import { loadLifecycleApproval } from './publication-service';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const captured = z.strictObject({
  buildId: z.uuid().optional(),
  buildDigest: digest.optional(),
  effectDigest: digest,
  artifactReceipt: digest,
  evidenceDigest: digest,
  routes: z.array(z.string().min(1).max(240)).min(1).max(128),
});
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
      const effectDigest = digest.parse(approval.effectDigest);
      const buildId =
        typeof approval.buildId === 'string' ? approval.buildId : undefined;
      const evidence = captured.parse(
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
