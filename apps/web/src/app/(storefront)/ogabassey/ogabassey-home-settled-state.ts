import { unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import type { getRequestScopedMerchant } from '@/lib/cached-data';
import type { OgabasseyHomeHeroShellResult } from './ogabassey-home-hero-shell-data';

export type CanonicalOgabasseyHomeMerchant = Awaited<
  ReturnType<typeof getRequestScopedMerchant>
>;

export interface SettledCanonicalOgabasseyHomeState {
  heroShell: OgabasseyHomeHeroShellResult | null;
  heroShellSettled: boolean;
  merchant: CanonicalOgabasseyHomeMerchant | null;
  merchantSettled: boolean;
  slug: string | null;
}

function createEmptySettledState(): SettledCanonicalOgabasseyHomeState {
  return {
    heroShell: null,
    heroShellSettled: false,
    merchant: null,
    merchantSettled: false,
    slug: null,
  };
}

// Per-request state box backed by React's server-component request cache.
// Concurrent requests never share a React.cache() dispatcher, and calls outside
// an active RSC request receive a fresh ephemeral box.
const getRequestSettledStateBox = cache(createEmptySettledState);

const settledBoxesByParams = new WeakMap<
  object,
  Set<SettledCanonicalOgabasseyHomeState>
>();

export async function settleCanonicalOgabasseyHomeMerchant(
  lookup: Promise<CanonicalOgabasseyHomeMerchant>
): Promise<CanonicalOgabasseyHomeMerchant | null> {
  try {
    return await lookup;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

function copySettledState(
  source: SettledCanonicalOgabasseyHomeState,
  target: SettledCanonicalOgabasseyHomeState
): void {
  target.heroShell = source.heroShell;
  target.heroShellSettled = source.heroShellSettled;
  target.merchant = source.merchant;
  target.merchantSettled = source.merchantSettled;
  target.slug = source.slug;
}

export function getSettledCanonicalOgabasseyHomeStateBox(
  params?: Promise<{ slug: string }> | null
): SettledCanonicalOgabasseyHomeState {
  const box = getRequestSettledStateBox();
  if (params && typeof params === 'object') {
    let boxes = settledBoxesByParams.get(params);
    if (!boxes) {
      boxes = new Set();
      settledBoxesByParams.set(params, boxes);
    }
    for (const existing of boxes) {
      if (existing.heroShellSettled || existing.merchantSettled) {
        copySettledState(existing, box);
        break;
      }
    }
    boxes.add(box);
  }
  return box;
}

export function recordSettledCanonicalOgabasseyHomeState({
  box: providedBox,
  heroShell,
  merchant,
  params,
  slug,
}: {
  box?: SettledCanonicalOgabasseyHomeState;
  heroShell: OgabasseyHomeHeroShellResult | null;
  merchant: CanonicalOgabasseyHomeMerchant | null;
  params?: Promise<{ slug: string }> | null;
  slug: string;
}): SettledCanonicalOgabasseyHomeState {
  const requestBox = getRequestSettledStateBox();
  const box = providedBox ?? requestBox;
  // Only a published merchant with its own published hero shell counts as
  // settled. Failed lookups (null), unpublished stores, or a mismatched shell
  // stay unsettled so the async path keeps its reserve/404 guards.
  const isPublishedCanonicalState =
    Boolean(merchant) &&
    merchant?.is_published === true &&
    heroShell?.status === 'published' &&
    heroShell.merchantId === merchant.id;
  box.heroShell = isPublishedCanonicalState ? heroShell : null;
  box.heroShellSettled = isPublishedCanonicalState;
  box.merchant = isPublishedCanonicalState ? (merchant ?? null) : null;
  box.merchantSettled = isPublishedCanonicalState;
  box.slug = isPublishedCanonicalState ? slug : null;
  if (requestBox !== box) {
    copySettledState(box, requestBox);
  }

  if (params && typeof params === 'object') {
    let boxes = settledBoxesByParams.get(params);
    if (!boxes) {
      boxes = new Set();
      settledBoxesByParams.set(params, boxes);
    }
    boxes.add(box);
    boxes.add(requestBox);
    for (const boundBox of boxes) {
      if (boundBox !== box) {
        copySettledState(box, boundBox);
      }
    }
  }

  return box;
}

export function hydrateSettledCanonicalOgabasseyHomeStateFromParams(
  params?: Promise<{ slug: string }> | null
): SettledCanonicalOgabasseyHomeState | null {
  const box = getSettledCanonicalOgabasseyHomeStateBox(params);
  if (box.slug && box.heroShellSettled && box.merchantSettled) {
    return box;
  }

  return null;
}

export function peekSettledCanonicalOgabasseyHomeState(): SettledCanonicalOgabasseyHomeState | null {
  const box = getRequestSettledStateBox();
  return box.heroShellSettled || box.merchantSettled ? box : null;
}
