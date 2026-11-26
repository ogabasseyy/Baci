'use server';

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { upstreamAuthorizationDecision } from '@/schemas/builder-upstream-oauth';
import {
  parseBuilderCallback,
  readBuilderConsent,
  SITE_ORIGIN,
} from './authorization';

export async function decideBuilderOAuthAuthorization(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user || (await headers()).get('origin') !== SITE_ORIGIN)
    notFound();

  const parsed = upstreamAuthorizationDecision.safeParse({
    authorizationId: formData.get('authorizationId'),
    decision: formData.get('decision'),
  });
  if (!parsed.success) notFound();
  const { authorizationId, decision } = parsed.data;
  const oauth = supabase.auth.oauth;
  const consent = await readBuilderConsent(
    oauth,
    authorizationId,
    user.id,
    true
  );
  if (!consent) notFound();
  if (consent.kind === 'approved') {
    if (decision !== 'approve') notFound();
    redirect(consent.destination);
  }

  const options = { skipBrowserRedirect: true };
  const { data, error } =
    decision === 'approve'
      ? await oauth.approveAuthorization(authorizationId, options)
      : await oauth.denyAuthorization(authorizationId, options);
  const destination = parseBuilderCallback(data?.redirect_url);
  if (error || !destination) notFound();

  redirect(destination);
}
