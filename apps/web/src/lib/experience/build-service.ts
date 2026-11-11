import { experienceBuildInput } from '@/schemas/experience-job';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';

export {
  type CompiledCandidate,
  verifyCompiledCandidate,
} from './compiled-candidate';

export async function queueExperienceBuild(
  inputCtx: OwnerRequestContext,
  input: unknown
) {
  const v = experienceBuildInput.parse(input);
  const ctx = await requireExperienceOwner(inputCtx);
  const result = await ctx.supabase.rpc('experience_queue_build', {
    ...ownerRpcArgs(ctx),
    p_artifact: v.artifactId,
    p_retry: v.idempotencyKey,
  });
  if (result.error || typeof result.data !== 'string')
    throw Error('IDEMPOTENCY_CONFLICT');
  return { jobId: result.data };
}
export async function readExperienceOperation(
  inputCtx: OwnerRequestContext,
  jobId: string
) {
  const ctx = await requireExperienceOwner(inputCtx, 'storefront.read');
  const r = await ctx.supabase
    .from('experience_jobs')
    .select('id,status,expires_at')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', jobId)
    .maybeSingle();
  if (r.error || !r.data) throw Error('NOT_FOUND');
  return r.data as { id: string; status: string; expires_at: string };
}
