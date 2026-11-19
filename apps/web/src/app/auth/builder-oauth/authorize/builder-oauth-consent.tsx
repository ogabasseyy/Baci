import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { upstreamAuthorizationId } from '@/schemas/builder-upstream-oauth';
import { decideBuilderOAuthAuthorization } from './actions';
import { AUTHORIZATION_PATH, readBuilderConsent } from './authorization';

export interface BuilderOAuthConsentProps {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}

export async function BuilderOAuthConsent({
  searchParams,
}: BuilderOAuthConsentProps) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  const parsed = upstreamAuthorizationId.safeParse(
    (await searchParams).authorization_id
  );
  if (!parsed.success) notFound();
  const authorizationId = parsed.data;

  if (error || !user) {
    const query = new URLSearchParams({ authorization_id: authorizationId });
    const login = new URLSearchParams({
      redirect: `${AUTHORIZATION_PATH}?${query}`,
    });
    redirect(`/login?${login}`);
  }
  const consent = await readBuilderConsent(
    supabase.auth.oauth,
    authorizationId,
    user.id,
    true
  );
  if (!consent) notFound();

  return (
    <main className="mx-auto max-w-md space-y-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Connect Baci Website Builder</h1>
      <p>
        Verify your Baci account for Baci Website Builder in ChatGPT. After
        verification, you can review the store and requested permissions before
        connecting.
      </p>
      <form action={decideBuilderOAuthAuthorization} className="flex gap-3">
        <input type="hidden" name="authorizationId" value={authorizationId} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Verify account
        </button>
        {consent.kind === 'pending' && (
          <button
            type="submit"
            name="decision"
            value="deny"
            className="rounded-md border px-4 py-2"
          >
            Decline
          </button>
        )}
      </form>
    </main>
  );
}
