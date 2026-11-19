import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { upstreamAuthorizationId } from '@/schemas/builder-upstream-oauth';
import { decideBuilderOAuthAuthorization } from './actions';
import { AUTHORIZATION_PATH, readBuilderConsent } from './authorization';

export const metadata = {
  title: 'Connect Baci Website Builder',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
} as const;

export default async function BuilderOAuthAuthorization({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
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
        Allow Baci Website Builder to verify your Baci account. You’ll choose
        which store to link and what the builder can do on the next screen.
      </p>
      <form action={decideBuilderOAuthAuthorization} className="flex gap-3">
        <input type="hidden" name="authorizationId" value={authorizationId} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Continue
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
