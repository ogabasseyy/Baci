import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { experienceToolInputs } from '@/schemas/experience-tools';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
export async function requestExperiencePublication(
  ctx: OwnerRequestContext,
  input: unknown,
  action: 'publish' | 'rollback' = 'publish'
) {
  const v =
    experienceToolInputs[
      action === 'publish' ? 'publish_experience' : 'rollback_experience'
    ].parse(input);
  const owner = await requireExperienceOwner(ctx, 'storefront.publish');
  if (owner.identity && !owner.identity.scopes.has('storefront.publish'))
    throw Error('INSUFFICIENT_SCOPE');
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
  return z.record(z.string(), z.json()).parse(r.data);
}
export async function loadLifecycleApproval(
  client: SupabaseClient,
  id: string
) {
  z.uuid().parse(id);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  const r = await client.rpc('experience_load_lifecycle', { p_intent: id });
  if (r.error) throw Error('UNAVAILABLE');
  return z.record(z.string(), z.json()).parse(r.data);
}
/** Owner-web only; never imported into the model dispatcher. */
export async function confirmExperiencePublication(
  client: SupabaseClient,
  id: string
) {
  z.uuid().parse(id);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  const r = await client.rpc('experience_confirm_publication', {
    p_intent: id,
  });
  if (r.error) throw Error('UNAVAILABLE');
  return z.record(z.string(), z.json()).parse(r.data);
}
