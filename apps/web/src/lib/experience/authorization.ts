import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderContext } from '@/lib/builder-connector/types';
export interface OwnerRequestContext {
  merchantId: string;
  supabase: SupabaseClient;
  identity?: BuilderContext['identity'];
  signal?: AbortSignal;
}
export interface ExperienceContext extends OwnerRequestContext {
  actorUserId: string;
}
async function getOwnerUser(client: SupabaseClient, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!signal) return client.auth.getUser();

  // Auth's getUser API has no per-call AbortSignal. Release this caller
  // immediately while observing the eventual transport result.
  const pending =
    Promise.withResolvers<Awaited<ReturnType<typeof client.auth.getUser>>>();
  const abort = () => pending.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    client.auth.getUser().then(pending.resolve, pending.reject);
    return await pending.promise;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Early rejection. Every write RPC repeats authorization under the grant lock. */
export async function requireExperienceOwner(
  ctx: BuilderContext | OwnerRequestContext,
  scope:
    | 'storefront.read'
    | 'storefront.write'
    | 'storefront.publish' = 'storefront.write'
): Promise<ExperienceContext> {
  const signal = 'signal' in ctx ? ctx.signal : undefined;
  const { data, error } = await getOwnerUser(ctx.supabase, signal);
  signal?.throwIfAborted();
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
  const query = (ctx.supabase as SupabaseClient).rpc(
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
  const result = await (signal ? query.abortSignal(signal) : query);
  signal?.throwIfAborted();
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
