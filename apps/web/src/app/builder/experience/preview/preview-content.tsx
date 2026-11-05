import { createClient } from '@/lib/supabase/server';
import { experiencePreviewPageInput } from '@/schemas/experience-preview';
import { PreviewClient } from './preview-client';
export async function PrivatePreviewContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ids = experiencePreviewPageInput.safeParse(params);
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    const query = ids.success
      ? `?${new URLSearchParams({ merchant: ids.data.merchant, build: ids.data.build, ...(ids.data.routeId ? { routeId: ids.data.routeId } : {}) }).toString()}`
      : '';
    return (
      <main>
        <h1>Private full-code preview</h1>
        <a
          href={
            '/login?redirect=' +
            encodeURIComponent(`/builder/experience/preview${query}`)
          }
        >
          Sign in to Baci
        </a>
      </main>
    );
  }
  if (!ids.success)
    return (
      <main>
        <h1>Private full-code preview</h1>
        <p>Request a fresh private build preview from Baci.</p>
      </main>
    );
  return (
    <PreviewClient
      merchantId={ids.data.merchant}
      buildId={ids.data.build}
      routeId={ids.data.routeId}
    />
  );
}
