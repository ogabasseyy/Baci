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
const BUILDER_CALLBACK = `${BUILDER_ISSUER}/upstream/callback`;

type OAuth = Awaited<ReturnType<typeof createClient>>['auth']['oauth'];

export async function readBuilderConsent(
  oauth: OAuth,
  authorizationId: string,
  actorUserId: string,
  allowApproved = false
): Promise<
  { kind: 'pending' } | { kind: 'approved'; destination: string } | null
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
  const destination = approved.data.redirect_url;
  if (!isBuilderCallback(destination)) return null;
  const { searchParams } = new URL(destination);
  if (
    !searchParams.get('code') ||
    searchParams.getAll('code').length !== 1 ||
    !searchParams.get('state') ||
    searchParams.getAll('state').length !== 1 ||
    searchParams.getAll('iss').length > 1 ||
    [...searchParams.keys()].some(
      (param) => !['code', 'state', 'iss'].includes(param)
    )
  )
    return null;
  return { kind: 'approved', destination };
}

export function isBuilderCallback(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.origin + url.pathname === BUILDER_CALLBACK &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}
