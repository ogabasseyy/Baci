import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
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

function createSettledStateBox(): SettledCanonicalOgabasseyHomeState {
  return {
    heroShell: null,
    heroShellSettled: false,
    merchant: null,
    merchantSettled: false,
    slug: null,
  };
}

const getReactCacheSettledStateBox = cache(createSettledStateBox);

const settledBoxByWorkStore = new WeakMap<
  object,
  SettledCanonicalOgabasseyHomeState
>();

const settledBoxesByParams = new WeakMap<
  object,
  Set<SettledCanonicalOgabasseyHomeState>
>();

const storefrontPageParams = new WeakSet<object>();
const deferredCommittedLcpParams = new WeakSet<object>();

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

function getRequestSettledStateBox(): SettledCanonicalOgabasseyHomeState {
  const workStore = workAsyncStorage.getStore();
  if (workStore && typeof workStore === 'object') {
    let workBox = settledBoxByWorkStore.get(workStore);
    if (!workBox) {
      workBox = createSettledStateBox();
      settledBoxByWorkStore.set(workStore, workBox);
    }
    const reactBox = getReactCacheSettledStateBox();
    if (
      !workBox.heroShellSettled &&
      !workBox.merchantSettled &&
      (reactBox.heroShellSettled || reactBox.merchantSettled)
    ) {
      copySettledState(reactBox, workBox);
    } else if (
      (workBox.heroShellSettled || workBox.merchantSettled) &&
      reactBox !== workBox
    ) {
      copySettledState(workBox, reactBox);
    }
    return workBox;
  }

  return getReactCacheSettledStateBox();
}

export function markStorefrontPageParams(
  params?: Promise<{ slug: string }> | null
): void {
  if (params && typeof params === 'object') {
    storefrontPageParams.add(params);
  }
}

export function isStorefrontPageParams(
  params?: Promise<{ slug: string }> | null
): boolean {
  return Boolean(
    params && typeof params === 'object' && storefrontPageParams.has(params)
  );
}

export function markDeferredCommittedLcpToRoute(
  params?: Promise<{ slug: string }> | null
): void {
  if (params && typeof params === 'object') {
    deferredCommittedLcpParams.add(params);
  }
}

export function isDeferredCommittedLcpToRoute(
  params?: Promise<{ slug: string }> | null
): boolean {
  return Boolean(
    params &&
      typeof params === 'object' &&
      deferredCommittedLcpParams.has(params)
  );
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
  const reactBox = getReactCacheSettledStateBox();
  if (reactBox !== box) {
    copySettledState(box, reactBox);
  }

  if (params && typeof params === 'object') {
    let boxes = settledBoxesByParams.get(params);
    if (!boxes) {
      boxes = new Set();
      settledBoxesByParams.set(params, boxes);
    }
    boxes.add(box);
    boxes.add(requestBox);
    boxes.add(reactBox);
    for (const boundBox of boxes) {
      if (boundBox !== box) {
        copySettledState(box, boundBox);
      }
    }
  }

  return box;
}

export async function settleCanonicalOgabasseyHomeState({
  getMerchant,
  params,
  resolveHeroShell,
  slug,
  stateBox,
}: {
  getMerchant: (slug: string) => Promise<CanonicalOgabasseyHomeMerchant>;
  params: Promise<{ slug: string }>;
  resolveHeroShell: () => Promise<OgabasseyHomeHeroShellResult | null>;
  slug: string;
  stateBox: SettledCanonicalOgabasseyHomeState;
}): Promise<SettledCanonicalOgabasseyHomeState> {
  if (
    stateBox.slug === slug &&
    stateBox.heroShellSettled &&
    stateBox.merchantSettled
  ) {
    return stateBox;
  }

  const [resolvedMerchant, heroShell] = await Promise.all([
    Promise.resolve(getMerchant(slug)).catch(() => null),
    Promise.resolve(resolveHeroShell()).catch(() => null),
  ]);

  return recordSettledCanonicalOgabasseyHomeState({
    box: stateBox,
    heroShell,
    merchant: resolvedMerchant,
    params,
    slug,
  });
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
  if (!box.heroShellSettled && !box.merchantSettled) {
    return null;
  }
  return box;
}
