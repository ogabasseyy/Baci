import type { SupabaseClient } from '@supabase/supabase-js';
import { experienceModeExitInput } from '@/schemas/experience-mode-exit';
import {
  experienceApprovalId,
  experienceLifecycleReceipt,
} from '@/schemas/experience-publication';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
export async function requestExperienceModeExit(
  ctx: OwnerRequestContext,
  input: unknown
) {
  const v = experienceModeExitInput.parse(input);
  const owner = await requireExperienceOwner(
    ctx,
    v.effect === 'draft-only' ? 'storefront.write' : 'storefront.publish'
  );
  if (
    owner.identity &&
    v.effect !== 'draft-only' &&
    !owner.identity.scopes.has('storefront.publish')
  )
    throw Error('INSUFFICIENT_SCOPE');
  const r = await owner.supabase.rpc('experience_request_lifecycle', {
    ...ownerRpcArgs(owner),
    p_action: v.effect,
    p_payload: {
      expectedDraftVersion: v.expectedDraftVersion,
      expectedPublishedVersion: v.expectedPublishedVersion,
      targetLegacyRevision: v.targetLegacyRevision,
    },
    p_retry: v.idempotencyKey,
  });
  if (r.error) throw Error('UNAVAILABLE');
  return experienceLifecycleReceipt.parse(r.data);
}
/** Owner-web only; model tools have no confirmation dispatch. */
export async function confirmExperienceModeExit(
  client: SupabaseClient,
  id: string
) {
  experienceApprovalId.parse(id);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  const r = await client.rpc('experience_confirm_mode_exit', { p_intent: id });
  if (r.error) throw Error('UNAVAILABLE');
  return experienceLifecycleReceipt.parse(r.data);
}
