import type { ReactNode } from 'react';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import {
  getSettledCanonicalOgabasseyHomeStateBox,
  recordSettledCanonicalOgabasseyHomeState,
  settleCanonicalOgabasseyHomeMerchant,
} from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { isOgabasseyCanonicalDomainSlug } from './is-ogabassey-home-identifier';

export default async function StorefrontFullCssLayout({
  children,
  params,
}: {
  children: ReactNode;
  params?: Promise<{ slug: string }>;
}) {
  if (!params) {
    return children;
  }

  const stateBox = getSettledCanonicalOgabasseyHomeStateBox(params);
  const { slug } = await params;

  if (isOgabasseyCanonicalDomainSlug(slug)) {
    const [heroShell, resolvedMerchant] = await Promise.all([
      resolveOgabasseyHomeHeroShell(),
      settleCanonicalOgabasseyHomeMerchant(getRequestScopedMerchant(slug)),
    ]);
    recordSettledCanonicalOgabasseyHomeState({
      box: stateBox,
      heroShell,
      merchant: resolvedMerchant,
      params,
      slug,
    });
  }

  return children;
}
