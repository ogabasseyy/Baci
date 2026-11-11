import { randomUUID } from 'node:crypto';
import { loadDraftApproval } from '@/lib/experience/approval-service';
import type { IndependentApprovalDependencies } from '@/lib/experience/independent-approval-verifier';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import type { createVerifierCaptureWorker } from './capture-worker';

type Worker = Awaited<ReturnType<typeof createVerifierCaptureWorker>>;

/** Runs only in the verifier process; never accepts source, screenshot or proof bytes. */
export function createApprovalCapture(
  worker: Worker
): IndependentApprovalDependencies['capture'] {
  return async (client, binding) => {
    const approval =
      binding.kind === 'draft'
        ? await loadDraftApproval(client, binding.approvalId)
        : await loadLifecycleApproval(client, binding.approvalId);
    if (
      approval.status !== 'confirmation-required' ||
      approval.approvalId !== binding.approvalId ||
      approval.effectDigest !== binding.effectDigest ||
      typeof approval.merchantId !== 'string' ||
      typeof approval.buildId !== 'string' ||
      approval.buildId !== binding.buildId
    )
      throw Error('APPROVAL_MISMATCH');
    const merchantId = approval.merchantId;
    const build = await client
      .from('experience_builds')
      .select('job_id,build_digest,host_origin')
      .eq('merchant_id', merchantId)
      .eq('id', approval.buildId)
      .maybeSingle();
    if (build.error || !build.data) throw Error('APPROVAL_MISMATCH');
    const job = await client
      .from('experience_jobs')
      .select('artifact_id,attempt_nonce,status')
      .eq('merchant_id', merchantId)
      .eq('id', build.data.job_id)
      .maybeSingle();
    if (job.error || !job.data || job.data.status !== 'finalized')
      throw Error('APPROVAL_MISMATCH');
    const artifact = await client
      .from('experience_artifacts')
      .select('manifest')
      .eq('merchant_id', merchantId)
      .eq('id', job.data.artifact_id)
      .maybeSingle();
    if (artifact.error || !artifact.data) throw Error('APPROVAL_MISMATCH');
    const manifest = parseExperienceManifest(artifact.data.manifest);
    const attestation = await client
      .from('experience_evidence')
      .select('id,receipt_digest')
      .eq('merchant_id', merchantId)
      .eq('job_id', build.data.job_id)
      .eq('attempt_nonce', job.data.attempt_nonce)
      .eq('build_digest', build.data.build_digest)
      .eq('host_origin', build.data.host_origin)
      .maybeSingle();
    if (
      attestation.error ||
      !attestation.data ||
      (binding.kind === 'draft' && attestation.data.id !== approval.evidenceId)
    )
      throw Error('APPROVAL_MISMATCH');
    const proofs = [];
    for (const route of manifest.routes) {
      const captured = await worker(
        { supabase: client, merchantId },
        {
          buildId: approval.buildId,
          routeId: route.path,
          idempotencyKey: randomUUID(),
        }
      );
      const snapshot = await client
        .from('experience_snapshots')
        .select('build_id,build_digest,evidence_digest')
        .eq('merchant_id', merchantId)
        .eq('id', captured.evidenceId)
        .maybeSingle();
      if (
        snapshot.error ||
        !snapshot.data ||
        snapshot.data.build_id !== approval.buildId ||
        snapshot.data.build_digest !== build.data.build_digest
      )
        throw Error('APPROVAL_MISMATCH');
      proofs.push({ path: route.path, digest: snapshot.data.evidence_digest });
    }
    return {
      buildId: approval.buildId,
      buildDigest: build.data.build_digest,
      effectDigest: binding.effectDigest,
      artifactReceipt: attestation.data.receipt_digest,
      evidenceDigest: digestBytes(JSON.stringify(proofs)),
      routes: proofs.map((proof) => proof.path),
    };
  };
}
