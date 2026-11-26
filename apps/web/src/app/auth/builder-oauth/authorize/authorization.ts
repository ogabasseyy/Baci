import 'server-only';
import { BUILDER_ISSUER } from '@/lib/builder-connector/resource';
import type { createClient } from '@/lib/supabase/server';
import {
  upstreamApprovedRedirect,
  upstreamAuthorizationConsent,
  upstreamAuthorizationId,
} from '@/schemas/builder-upstream-oauth';

export const SITE_ORIGIN = 'https://usebaci.com';
export const AUTHORIZATION_PATH = '/auth/builder-oauth/authorize';
const BUILDER_CALLBACK = `${BUILDER_ISSUER}/upstream/callback` as const;
type BuilderCallback = `${typeof BUILDER_CALLBACK}${string}`;

type OAuth = Awaited<ReturnType<typeof createClient>>['auth']['oauth'];

export async function readBuilderConsent(
  oauth: OAuth,
  authorizationId: string,
  actorUserId: string,
  allowApproved = false
): Promise<
  | { kind: 'pending' }
  | { kind: 'approved'; destination: BuilderCallback }
  | null
> {
  const clientId = upstreamAuthorizationId.safeParse(
    process.env.BACI_BUILDER_UPSTREAM_OAUTH_CLIENT_ID
  );
  if (!clientId.success) return null;

  const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return null;
  const details = upstreamAuthorizationConsent.safeParse(data);
  if (
    details.success &&
    details.data.authorization_id === authorizationId &&
    details.data.client.id === clientId.data &&
    details.data.user.id === actorUserId &&
    details.data.redirect_uri === BUILDER_CALLBACK
  )
    return { kind: 'pending' };

  // GoTrue may issue a code for an existing grant even with prompt=consent.
  // The callback is exclusive to the configured client. The broker also
  // validates the code, client identity, state and PKCE before linking.
  const approved = upstreamApprovedRedirect.safeParse(data);
  if (!allowApproved || !approved.success) return null;
  const destination = parseBuilderCallback(approved.data.redirect_url);
  if (!destination) return null;
  const { searchParams } = new URL(destination);
  if (
    !searchParams.get('code') ||
    searchParams.getAll('code').length !== 1 ||
    !searchParams.get('state') ||
    searchParams.getAll('state').length !== 1 ||
    [...searchParams.keys()].some(
      (param) => !['code', 'state', 'iss'].includes(param)
    )
  )
    return null;
  return { kind: 'approved', destination };
}

export function parseBuilderCallback(
  value: string | undefined
): BuilderCallback | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.origin + url.pathname !== BUILDER_CALLBACK ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    const issuers = url.searchParams.getAll('iss');
    if (issuers.length) {
      // GoTrue issues this response. The builder broker owns the callback,
      // while the configured Supabase Auth server is the upstream issuer.
      const upstream = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
      if (issuers.length !== 1 || issuers[0] !== `${upstream.origin}/auth/v1`)
        return null;
    }
    return `${BUILDER_CALLBACK}${url.search}`;
  } catch {
    return null;
  }
}
