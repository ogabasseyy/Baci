import { notFound } from 'next/navigation';
import { isPilotLabEnabled } from '@/lib/merchant-image-variant-pilot/lab-config';
import {
  pilotLabStoreBasePath,
  pilotLabStoreBySlug,
} from '@/lib/merchant-image-variant-pilot/lab-store-page';

// Lab-only fixture product destination:
// /pilot-lab/store/<slug>/lab-category/<productSlug>. The original card
// renderer links every fixture product here (category "Lab Category") with
// default Link prefetching, so this route must exist and return 200 —
// otherwise every measurement collects RSC-prefetch 404s and console errors.
// Minimal and arm-independent (fixture hrefs are identical in both arms);
// never measured, only a valid prefetch/render target.
//
// Same guard + rendering contract as the store route: 404 without
// BACI_IMAGE_PILOT_LAB=1, 404 for unknown stores, route-scoped
// `instant = false` (request-time params under cacheComponents).
export const instant = false;

export default async function PilotLabFixtureProductRoute({
  params,
  searchParams,
}: {
  params: Promise<{ productSlug: string; storeSlug: string }>;
  searchParams?: Promise<{ arm?: string }>;
}): Promise<React.JSX.Element> {
  if (!isPilotLabEnabled()) {
    notFound();
  }
  const { productSlug, storeSlug } = await params;
  const store = pilotLabStoreBySlug(storeSlug);
  if (!store) {
    notFound();
  }
  // Preserve the arm on the way back: without it the store renders the
  // pilot default, silently flipping a control session mid-browse.
  const arm = (await searchParams)?.arm;
  const back =
    arm === 'pilot' || arm === 'control'
      ? `${pilotLabStoreBasePath(store)}?arm=${arm}`
      : pilotLabStoreBasePath(store);
  return (
    <main>
      <p data-pilot-lab-fixture-product="true">
        {store.storeName} lab fixture product: {productSlug}
      </p>
      <a href={back}>Back to {store.storeName} lab</a>
    </main>
  );
}
