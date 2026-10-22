import { createAuthenticatedUserClient } from '@/lib/supabase/authenticated-user-client';
import { builderToolPolicy } from './tool-policy';
import type { BuilderContext, BuilderIdentity, BuilderToolName } from './types';

type ResolverDependencies = {
  supabase: { url: string; anonKey: string };
  /** Private backend only: validates live grant/version and renews its dedicated session. */
  resolveLinkedAccessToken: (identity: BuilderIdentity) => Promise<string>;
};
export function createBuilderUserClientResolver(deps: ResolverDependencies) {
  return async function resolveBuilderUserClient(identity: BuilderIdentity) {
    const accessToken = await deps.resolveLinkedAccessToken(identity);
    return createAuthenticatedUserClient({
      ...deps.supabase,
      accessToken,
      actorUserId: identity.actorUserId,
    });
  };
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
    const { data, error } = await supabase
      .from('merchants')
      .select('id,user_id')
      .eq('id', merchantId)
      .eq('user_id', identity.actorUserId)
      .maybeSingle();
    if (error || !data || data.user_id !== identity.actorUserId)
      throw new Error('Storefront not found.');
    return { identity, merchantId: data.id, supabase };
  };
}
