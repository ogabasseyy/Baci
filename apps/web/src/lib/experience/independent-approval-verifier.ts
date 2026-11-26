import type { SupabaseClient } from '@supabase/supabase-js';
import {
  experienceCapturedEvidence,
  experienceVerifierDigest,
} from '@/schemas/experience-captured-evidence';
import { verifierApprovalExpiry } from '@/schemas/experience-verification-records';
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
    },
    signal?: AbortSignal
  ): Promise<unknown>;
  /** Restricted verifier connection; no business/source client or service-role factory. */
  record(input: {
    approvalId: string;
    kind: 'draft' | 'lifecycle';
    effectDigest: string;
    markerDigest: string;
    expiresAt: string;
  }): Promise<void>;
  verifyPublic(
    client: SupabaseClient,
    receipt: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void>;
}
export function createIndependentApprovalVerifier(
  deps: IndependentApprovalDependencies
): OwnerLifecycleVerification {
  return {
    attest: async (client, approvalId, kind, requestSignal) => {
      requestSignal?.throwIfAborted();
      const approval =
        kind === 'draft'
          ? await loadDraftApproval(client, approvalId, requestSignal)
          : await loadLifecycleApproval(client, approvalId, requestSignal);
      if (approval.status !== 'confirmation-required') return;
      const effectDigest = experienceVerifierDigest.parse(
        approval.effectDigest
      );
      const expiresAt = verifierApprovalExpiry.parse(approval.expiresAt);
      const remainingMs = Date.parse(expiresAt) - Date.now();
      if (remainingMs <= 0) throw Error('APPROVAL_EXPIRED');
      // The listener already cancels long requests. Respect an earlier
      // PostgreSQL approval expiry when the owner starts with time elapsed.
      const expirySignal =
        remainingMs < 550_000 ? AbortSignal.timeout(remainingMs) : undefined;
      const signal =
        requestSignal && expirySignal
          ? AbortSignal.any([requestSignal, expirySignal])
          : (requestSignal ?? expirySignal);
      const buildId =
        typeof approval.buildId === 'string' ? approval.buildId : undefined;
      signal?.throwIfAborted();
      const evidence = experienceCapturedEvidence.parse(
        await deps.capture(
          client,
          { approvalId, kind, buildId, effectDigest },
          signal
        )
      );
      signal?.throwIfAborted();
      if (
        evidence.effectDigest !== effectDigest ||
        (buildId && evidence.buildId !== buildId)
      )
        throw Error('APPROVAL_MISMATCH');
      if (buildId) {
        if (typeof approval.merchantId !== 'string' || !evidence.buildDigest)
          throw Error('APPROVAL_MISMATCH');
        const build = await client
          .from('experience_builds')
          .select('build_digest')
          .eq('merchant_id', approval.merchantId)
          .eq('id', buildId)
          .maybeSingle();
        if (build.error || build.data?.build_digest !== evidence.buildDigest)
          throw Error('APPROVAL_MISMATCH');
      }
      signal?.throwIfAborted();
      const current =
        kind === 'draft'
          ? await loadDraftApproval(client, approvalId, signal)
          : await loadLifecycleApproval(client, approvalId, signal);
      if (
        current.status !== 'confirmation-required' ||
        current.effectDigest !== effectDigest ||
        current.merchantId !== approval.merchantId ||
        current.expiresAt !== expiresAt ||
        (buildId && current.buildId !== buildId)
      )
        throw Error('APPROVAL_MISMATCH');
      signal?.throwIfAborted();
      if (Date.parse(expiresAt) <= Date.now()) throw Error('APPROVAL_EXPIRED');
      await deps.record({
        approvalId,
        kind,
        effectDigest,
        markerDigest: digestBytes(JSON.stringify(evidence)),
        expiresAt,
      });
    },
    verifyCommitted: deps.verifyPublic,
  };
}
