import {
  experienceSourceCandidateInput,
  experienceSourceCandidateResult,
} from '@/schemas/experience-source-candidate';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
/** Adopt a completed chunk upload as private source without inflating MCP request limits. */
export async function adoptSourceCandidate(
  inputCtx: OwnerRequestContext,
  input: unknown
) {
  const v = experienceSourceCandidateInput.parse(input);
  const ctx = await requireExperienceOwner(inputCtx);
  const artifact = await ctx.supabase
    .from('experience_artifacts')
    .select('source_digest')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', v.artifactId)
    .maybeSingle();
  if (artifact.error || !artifact.data) throw Error('NOT_FOUND');
  const result = await ctx.supabase.rpc('experience_apply_source', {
    ...ownerRpcArgs(ctx),
    p_artifact: v.artifactId,
    p_base: v.baseDigest,
    p_expected: v.expectedVersion,
    p_retry: v.idempotencyKey,
    p_payload: artifact.data.source_digest,
  });
  if (result.error) throw Error('IDEMPOTENCY_CONFLICT');
  return experienceSourceCandidateResult.parse(result.data);
}
