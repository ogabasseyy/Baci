import type { SupabaseClient } from '@supabase/supabase-js';
import {
  experienceApprovalId,
  experienceLifecyclePublicationBinding,
  experienceLifecycleReceipt,
} from '@/schemas/experience-publication';
import { experienceToolInputs } from '@/schemas/experience-tools';
import { ApprovalExpired } from './approval-service';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import type { PerformanceReader } from './performance-read';
import { requirePublicationPerformance } from './publication-performance';
export async function requestExperiencePublication(
  ctx: OwnerRequestContext,
  input: unknown,
  action: 'publish' | 'rollback' = 'publish',
  readPerformance?: PerformanceReader
) {
  const v =
    experienceToolInputs[
      action === 'publish' ? 'publish_experience' : 'rollback_experience'
    ].parse(input);
  const owner = await requireExperienceOwner(ctx, 'storefront.publish');
  if (owner.identity && !owner.identity.scopes.has('storefront.publish'))
    throw Error('INSUFFICIENT_SCOPE');
  await requirePublicationPerformance(owner, v.buildId, readPerformance);
  const r = await owner.supabase.rpc('experience_request_lifecycle', {
    ...ownerRpcArgs(owner),
    p_action: action,
    p_payload: {
      buildId: v.buildId,
      expectedDraftVersion: v.expectedDraftVersion,
      expectedPublishedVersion: v.expectedPublishedVersion,
    },
    p_retry: v.idempotencyKey,
  });
  if (r.error) throw Error('UNAVAILABLE');
  return experienceLifecycleReceipt.parse(r.data);
}
export async function loadLifecycleApproval(
  client: SupabaseClient,
  id: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  experienceApprovalId.parse(id);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  signal?.throwIfAborted();
  const query = client.rpc('experience_load_lifecycle', { p_intent: id });
  const r = await (signal ? query.abortSignal(signal) : query);
  signal?.throwIfAborted();
  if (r.error?.message === 'APPROVAL_EXPIRED') throw new ApprovalExpired();
  if (r.error) throw Error('UNAVAILABLE');
  return experienceLifecycleReceipt.parse(r.data);
}
/** Owner-web only; never imported into the model dispatcher. */
export async function confirmExperiencePublication(
  client: SupabaseClient,
  id: string
) {
  experienceApprovalId.parse(id);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  const binding = experienceLifecyclePublicationBinding.parse(
    await loadLifecycleApproval(client, id)
  );
  if (binding.status === 'confirmation-required') {
    await requirePublicationPerformance(
      { merchantId: binding.merchantId, supabase: client },
      binding.buildId
    );
  } else if (!binding.receiptId) {
    // Only the normal authenticated SQL lifecycle read can certify a commit.
    throw Error('UNAVAILABLE');
  }
  const r = await client.rpc('experience_confirm_publication', {
    p_intent: id,
  });
  if (r.error) throw Error('UNAVAILABLE');
  return experienceLifecycleReceipt.parse(r.data);
}
