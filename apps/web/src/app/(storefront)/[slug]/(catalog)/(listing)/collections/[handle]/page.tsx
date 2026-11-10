import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ExperienceServerBoundary } from '@/components/storefront/experience/experience-server-boundary';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { loadPublishedExperience } from '@/lib/experience/published-manifest';
import { resolveExperienceBoundary } from '@/lib/experience/route-data-revision';
import { resolveExperienceRoute } from '@/lib/experience/route-ownership';
import { isValidMerchantIdentifier } from '@/lib/validation';

interface Props {
  params: Promise<{ slug: string; handle: string }>;
}
async function resolve(params: Props['params']) {
  const { slug, handle } = await params;
  if (!isValidMerchantIdentifier(slug) || !/^[a-z0-9-]{1,100}$/.test(handle))
    notFound();
  const merchant = await getRequestScopedMerchant(slug);
  if (!merchant) notFound();
  const manifest = await loadPublishedExperience(merchant);
  const path = `/collections/${handle}`;
  if (!manifest || !resolveExperienceRoute(manifest.routes, path)) notFound();
  const boundary = await resolveExperienceBoundary(merchant, path);
  if (!boundary) notFound();
  return { merchant, path, boundary };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { boundary } = await resolve(params);
  return {
    title: boundary.title,
    alternates: { canonical: boundary.canonicalUrl },
  };
}
async function ResolvedCollectionPage({ params }: Props) {
  const { merchant, path, boundary } = await resolve(params);
  return (
    <ExperienceServerBoundary
      merchant={merchant}
      path={path}
      fallback={
        <main>
          <h1>{boundary.title}</h1>
          <p>Continue with the trusted storefront.</p>
        </main>
      }
    />
  );
}

export default function CollectionPage(props: Props) {
  return (
    <Suspense fallback={<main role="status">Loading storefront…</main>}>
      <ResolvedCollectionPage {...props} />
    </Suspense>
  );
}
