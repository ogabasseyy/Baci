import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderContext } from '@/lib/builder-connector/types';
export interface OwnerRequestContext {
  merchantId: string;
  supabase: SupabaseClient;
  identity?: BuilderContext['identity'];
}
export interface ExperienceContext extends OwnerRequestContext {
  actorUserId: string;
}
/** Early rejection. Every write RPC repeats authorization under the grant lock. */
export async function requireExperienceOwner(
  ctx: BuilderContext | OwnerRequestContext,
  scope:
    | 'storefront.read'
    | 'storefront.write'
    | 'storefront.publish' = 'storefront.write'
): Promise<ExperienceContext> {
  const { data, error } = await ctx.supabase.auth.getUser();
  if (
    error ||
    !data.user ||
    (ctx.identity && ctx.identity.actorUserId !== data.user.id)
  )
    throw Error('NOT_FOUND');
  if (
    ctx.identity &&
    (!ctx.identity.scopes.has(scope) ||
      !ctx.identity.allowedMerchantIds.includes(ctx.merchantId))
  )
    throw Error('INSUFFICIENT_SCOPE');
  const result = await (ctx.supabase as SupabaseClient).rpc(
    scope === 'storefront.write'
      ? 'experience_require_owner'
      : scope === 'storefront.publish'
        ? 'experience_authorize_publish'
        : 'experience_authorize_read',
    {
      p_merchant: ctx.merchantId,
      p_connection: ctx.identity?.connectionId ?? null,
      p_version: ctx.identity?.grantVersion ?? null,
    }
  );
  if (result.error || result.data !== true) throw Error('NOT_FOUND');
  return { ...ctx, actorUserId: data.user.id };
}
export function ownerRpcArgs(ctx: ExperienceContext) {
  return {
    p_merchant: ctx.merchantId,
    p_connection: ctx.identity?.connectionId ?? null,
    p_version: ctx.identity?.grantVersion ?? null,
  };
}
