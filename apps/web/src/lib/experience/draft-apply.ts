import {
  experienceApplyInput,
  experienceApprovalRef,
} from '@/schemas/experience-publication';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
/** Model-facing: request an intent. Confirmation belongs exclusively to owner web. */
export async function requestDraftApply(
  inputCtx: OwnerRequestContext,
  input: unknown
) {
  const v = experienceApplyInput.parse(input);
  const ctx = await requireExperienceOwner(inputCtx);
  // Preview tools expose capture IDs. Resolve that trusted capture's immutable
  // build attestation under the same owner/RLS context; SQL rechecks its effect.
  const snapshot = await ctx.supabase
    .from('experience_snapshots')
    .select('build_id,build_digest')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', v.evidenceId)
    .maybeSingle();
  if (snapshot.error) throw Error('APPROVAL_UNAVAILABLE');
  let evidenceId = v.evidenceId;
  if (snapshot.data) {
    if (snapshot.data.build_id !== v.buildId)
      throw Error('APPROVAL_UNAVAILABLE');
    const build = await ctx.supabase
      .from('experience_builds')
      .select('job_id,build_digest,host_origin')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', v.buildId)
      .maybeSingle();
    if (
      build.error ||
      !build.data ||
      build.data.build_digest !== snapshot.data.build_digest
    )
      throw Error('APPROVAL_UNAVAILABLE');
    const job = await ctx.supabase
      .from('experience_jobs')
      .select('attempt_nonce,status')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', build.data.job_id)
      .maybeSingle();
    if (job.error || job.data?.status !== 'finalized')
      throw Error('APPROVAL_UNAVAILABLE');
    const attestation = await ctx.supabase
      .from('experience_evidence')
      .select('id')
      .eq('merchant_id', ctx.merchantId)
      .eq('job_id', build.data.job_id)
      .eq('attempt_nonce', job.data.attempt_nonce)
      .eq('build_digest', build.data.build_digest)
      .eq('host_origin', build.data.host_origin)
      .maybeSingle();
    if (attestation.error || !attestation.data)
      throw Error('APPROVAL_UNAVAILABLE');
    evidenceId = experienceApplyInput.shape.evidenceId.parse(
      attestation.data.id
    );
  }
  const result = await ctx.supabase.rpc('experience_request_draft_apply', {
    ...ownerRpcArgs(ctx),
    p_build: v.buildId,
    p_evidence: evidenceId,
    p_expected: v.expectedVersion,
    p_retry: v.idempotencyKey,
  });
  if (result.error) throw Error('APPROVAL_UNAVAILABLE');
  return experienceApprovalRef.parse(result.data);
}
