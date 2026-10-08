import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPilotLabEnabled } from '@/lib/merchant-image-variant-pilot/lab-config';
import type { PilotLabArm } from '@/lib/merchant-image-variant-pilot/lab-mount';
import {
  PilotLabStorePage,
  pilotLabStoreBySlug,
} from '@/lib/merchant-image-variant-pilot/lab-store-page';
import { labRequestOrigin } from '../../lab-request-origin';
import { getLabConfig } from '../../lab-route';

// Per-store lab pages: /pilot-lab/store/<slug>?arm=pilot|control. The
// measurement surfaces for the merchant image pilot — actual storefront
// components and shells per store (see lab-store-page.tsx). Same guard as
// the gallery: without BACI_IMAGE_PILOT_LAB=1 this route is a 404 and
// stages nothing. Unknown slugs are 404 (no binding table, no page).
//
// No `dynamic`/`revalidate` segment exports: the app runs with
// `cacheComponents` (see next.config.ts), which rejects them at compile
// time. This route reads request-time input (params + searchParams + the
// lab index load), so it declares `instant = false` — the route-scoped,
// cacheComponents-era way to allow request rendering without touching the
// global cacheComponents setting.
export const instant = false;

export default async function PilotLabStoreRoute({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>;
  searchParams: Promise<{ arm?: string }>;
}): Promise<React.JSX.Element> {
  if (!isPilotLabEnabled()) {
    notFound();
  }
  const { storeSlug } = await params;
  const store = pilotLabStoreBySlug(storeSlug);
  if (!store) {
    notFound();
  }
  const query = await searchParams;
  // Unknown ?arm values are 404, not silent pilot: a mistyped arm must
  // never render (and measure) the wrong comparison arm.
  if (
    query.arm !== undefined &&
    query.arm !== 'control' &&
    query.arm !== 'pilot'
  ) {
    notFound();
  }
  const arm: PilotLabArm = query.arm === 'control' ? 'control' : 'pilot';
  const config = await getLabConfig();
  // Request origin for the card path's absolute staged URLs (the original
  // card renderer rejects relative URLs — see lab-store-page.tsx).
  const requestHeaders = await headers();
  // Host only: X-Forwarded-Proto is untrusted without a trusted proxy,
  // so request-derived origins pin http; operators needing https set
  // BACI_IMAGE_PILOT_ORIGIN.
  const origin = labRequestOrigin({
    host: requestHeaders.get('host'),
  });
  return (
    <div data-pilot-lab-arm={arm}>
      <PilotLabStorePage
        arm={arm}
        config={config}
        origin={origin}
        store={store}
      />
    </div>
  );
}
