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
  const result = await ctx.supabase.rpc('experience_request_draft_apply', {
    ...ownerRpcArgs(ctx),
    p_build: v.buildId,
    p_evidence: v.evidenceId,
    p_expected: v.expectedVersion,
    p_retry: v.idempotencyKey,
  });
  if (result.error) throw Error('APPROVAL_UNAVAILABLE');
  return experienceApprovalRef.parse(result.data);
}
