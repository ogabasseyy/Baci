import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedUserClient } from '@/lib/supabase/authenticated-user-client';
import { builderToolPolicy } from './tool-policy';
import type { BuilderContext, BuilderIdentity, BuilderToolName } from './types';

type ResolverDependencies = {
  supabase: { url: string; anonKey: string };
  /** Private backend only: validates live grant/version and renews its dedicated session. */
  resolveLinkedAccessToken: (identity: BuilderIdentity) => Promise<string>;
};
export function createBuilderUserClientResolver(deps: ResolverDependencies) {
  return async function resolveBuilderUserClient(
    identity: BuilderIdentity,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const accessToken = await deps.resolveLinkedAccessToken(identity);
    return createAuthenticatedUserClient({
      ...deps.supabase,
      accessToken,
      actorUserId: identity.actorUserId,
      ...(signal && { authSignal: signal }),
    });
  };
}

export async function readBuilderOwnedMerchant(
  client: SupabaseClient,
  merchantId: string,
  actorUserId: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const query = client
    .from('merchants')
    .select('id,user_id')
    .eq('id', merchantId)
    .eq('user_id', actorUserId);
  const { data, error } = await (signal
    ? query.abortSignal(signal)
    : query
  ).maybeSingle();
  signal?.throwIfAborted();
  return !error && data?.user_id === actorUserId && typeof data.id === 'string'
    ? data.id
    : undefined;
}
export function createBuilderAccountResolver(deps: ResolverDependencies) {
  const resolveClient = createBuilderUserClientResolver(deps);
  return async function resolveBuilderContext(
    identity: BuilderIdentity,
    merchantId: string,
    operation: BuilderToolName
  ): Promise<BuilderContext> {
    if (
      !Object.hasOwn(builderToolPolicy, operation) ||
      !identity.allowedMerchantIds.includes(merchantId) ||
      builderToolPolicy[operation].scopes.some(
        (scope) => !identity.scopes.has(scope)
      )
    )
      throw new Error('Storefront not found.');
    const supabase = await resolveClient(identity);
    const ownedMerchant = await readBuilderOwnedMerchant(
      supabase,
      merchantId,
      identity.actorUserId
    );
    if (!ownedMerchant) throw new Error('Storefront not found.');
    return { identity, merchantId: ownedMerchant, supabase };
  };
}
