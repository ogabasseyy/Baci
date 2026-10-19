import type { ReactNode } from 'react';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import {
  getSettledCanonicalOgabasseyHomeStateBox,
  recordSettledCanonicalOgabasseyHomeState,
  type SettledCanonicalOgabasseyHomeState,
} from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { isOgabasseyCanonicalDomainSlug } from './is-ogabassey-home-identifier';

async function settleCanonicalHomeLayout(
  children: ReactNode,
  params: Promise<{ slug: string }>,
  stateBox: SettledCanonicalOgabasseyHomeState
) {
  const { slug } = await params;
  if (isOgabasseyCanonicalDomainSlug(slug)) {
    const [resolvedMerchant, heroShell] = await Promise.all([
      Promise.resolve(getRequestScopedMerchant(slug)).catch(() => null),
      Promise.resolve(resolveOgabasseyHomeHeroShell()).catch(() => null),
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

export default function StorefrontFullCssLayout({
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
  return settleCanonicalHomeLayout(children, params, stateBox);
}
