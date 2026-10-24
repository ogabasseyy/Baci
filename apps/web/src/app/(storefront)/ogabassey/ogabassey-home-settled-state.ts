import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { unstable_rethrow } from 'next/navigation';
import type React from 'react';
import { cache } from 'react';
import type { getRequestScopedMerchant } from '@/lib/cached-data';
import type { OgabasseyHomeHeroShellResult } from './ogabassey-home-hero-shell-data';

export type CanonicalOgabasseyHomeMerchant = Awaited<
  ReturnType<typeof getRequestScopedMerchant>
>;

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

const storefrontPageParams = new WeakSet<object>();
const deferredCommittedLcpParams = new WeakSet<object>();

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

// One shared box per request (Next WorkStore), never per process: concurrent
// requests and parallel prerenders run in the same Node process, so a module
// variable would leak one request's merchant/hero state into another.
const requestTreeSettledBoxes = new WeakMap<
  object,
  SettledCanonicalOgabasseyHomeState
>();

function getActiveRequestTreeStore(): object | null {
  try {
    const workStore = workAsyncStorage.getStore();
    if (workStore) return workStore as object;
  } catch {
    // Ignore store lookup failures outside Next.js request context
  }
  try {
    const unitStore = workUnitAsyncStorage.getStore();
    if (unitStore) return unitStore as object;
  } catch {
    // Ignore store lookup failures outside Next.js request context
  }
  return null;
}

function getActiveRequestTreeSettledBox(): SettledCanonicalOgabasseyHomeState | null {
  const store = getActiveRequestTreeStore();
  return store ? (requestTreeSettledBoxes.get(store) ?? null) : null;
}

function setActiveRequestTreeSettledBox(
  box: SettledCanonicalOgabasseyHomeState | null
): void {
  const store = getActiveRequestTreeStore();
  if (!store) return;
  if (box) requestTreeSettledBoxes.set(store, box);
  else requestTreeSettledBoxes.delete(store);
}

export function clearSettledCanonicalOgabasseyHomeState(): void {
  setActiveRequestTreeSettledBox(null);
}

export function isStorefrontHomeRequest(children?: React.ReactNode): boolean {
  try {
    const workStore = workAsyncStorage.getStore() as
      | { page?: string; route?: string }
      | undefined;
    if (workStore && typeof workStore.page === 'string') {
      return workStore.page.includes('(home)');
    }
    if (workStore && typeof workStore.route === 'string') {
      return workStore.route === '/[slug]';
    }
  } catch {
    // Ignore store lookup failures outside Next.js request context
  }

  try {
    const unitStore = workUnitAsyncStorage.getStore() as
      | { type?: string; url?: { pathname?: string } }
      | undefined;
    if (unitStore?.type === 'request' && unitStore.url?.pathname) {
      const pathname = unitStore.url.pathname;
      return pathname === '/' || pathname === '/ogabassey' || pathname === '';
    }
  } catch {
    // Ignore store lookup failures outside Next.js request context
  }

  if (children && typeof children === 'object' && 'type' in children) {
    const type = (children as { type?: unknown }).type;
    if (
      typeof type === 'function' &&
      (type.name === 'StorefrontFullCssLayout' ||
        type.name === 'StorefrontPage' ||
        type.name.includes('Home'))
    ) {
      return true;
    }
  }

  return false;
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
  const activeRequestTreeSettledBox = getActiveRequestTreeSettledBox();
  if (
    !box.heroShellSettled &&
    !box.merchantSettled &&
    activeRequestTreeSettledBox
  ) {
    copySettledState(activeRequestTreeSettledBox, box);
  }
  return box;
}

export function recordSettledCanonicalOgabasseyHomeState({
  box: providedBox,
  heroShell,
  merchant,
  params,
  shareAcrossRequestTree = false,
  slug,
}: {
  box?: SettledCanonicalOgabasseyHomeState;
  heroShell: OgabasseyHomeHeroShellResult | null;
  merchant: CanonicalOgabasseyHomeMerchant | null;
  params?: Promise<{ slug: string }> | null;
  shareAcrossRequestTree?: boolean;
  slug: string;
}): SettledCanonicalOgabasseyHomeState {
  const requestBox = getRequestSettledStateBox();
  const box = providedBox ?? requestBox;
  // Only a published merchant with its own published hero shell counts as
  // settled. Failed lookups (null), unpublished stores, or a mismatched shell
  // stay unsettled so the async path keeps its reserve/404 guards.
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isPublishedCanonicalState =
    Boolean(merchant) &&
    (merchant?.is_published === true || isDevelopment) &&
    heroShell?.status === 'published' &&
    heroShell.merchantId === merchant?.id;
  box.heroShell = isPublishedCanonicalState ? heroShell : null;
  box.heroShellSettled = isPublishedCanonicalState;
  box.merchant = isPublishedCanonicalState ? (merchant ?? null) : null;
  box.merchantSettled = isPublishedCanonicalState;
  box.slug = isPublishedCanonicalState ? slug : null;
  if (requestBox !== box) {
    copySettledState(box, requestBox);
  }
  if (shareAcrossRequestTree) {
    setActiveRequestTreeSettledBox(isPublishedCanonicalState ? box : null);
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
  if (!box.heroShellSettled && !box.merchantSettled) {
    const activeRequestTreeSettledBox = getActiveRequestTreeSettledBox();
    if (
      activeRequestTreeSettledBox &&
      (activeRequestTreeSettledBox.heroShellSettled ||
        activeRequestTreeSettledBox.merchantSettled)
    ) {
      copySettledState(activeRequestTreeSettledBox, box);
      return box;
    }
    return null;
  }
  return box;
}
