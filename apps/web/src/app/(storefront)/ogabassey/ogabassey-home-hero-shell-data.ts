import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { buildLaunchSlides } from '@/components/storefront/ogabassey/components/build-launch-slides';
import type { LaunchProductSlide } from '@/components/storefront/ogabassey/components/LaunchCarousel';
import { getCachedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';

const OGABASSEY_MERCHANT_SLUG = 'ogabassey';

// The shell lookup runs on the critical path of the home page's FIRST flush
// (it feeds both the slide-0 preload and request-gated Hero data). It is
// cached ('use cache: remote'), so it is near-instant on a warm cache and a
// single round-trip on a cold miss — but a degraded/saturated backend could
// otherwise stall the entire shell paint. Cap it: past this budget we fail
// closed by omitting the shopping Hero (losing only the promotional surface,
// never the page or publication guard).
const SHELL_LOOKUP_BUDGET_MS = 500;

export interface OgabasseyHomeHeroShell {
  status: 'published';
  merchantId: string;
  slides: LaunchProductSlide[];
}

export interface OgabasseyHomeHeroUnpublishedShell {
  status: 'unpublished';
}

export type OgabasseyHomeHeroShellResult =
  | OgabasseyHomeHeroShell
  | OgabasseyHomeHeroUnpublishedShell;

async function resolveShellSlides(): Promise<OgabasseyHomeHeroShellResult | null> {
  const merchant = await getCachedMerchant(OGABASSEY_MERCHANT_SLUG);
  if (!merchant?.id) {
    return null;
  }
  // Keep publication distinct from a degraded cache/feed result so the static
  // parent emits neither preload nor Hero-shaped fallback while the request
  // boundary renders StoreNotPublished.
  if (merchant.is_published !== true) {
    return { status: 'unpublished' };
  }

  // Per-leg failures inside loadOgabasseyLaunchProducts already degrade to
  // empty arrays, so a single failing feed cannot throw here. The publication-
  // gated Hero then keeps its fixed empty geometry after the guard succeeds.
  const products = await loadOgabasseyLaunchProducts(
    merchant.id,
    resolveMerchantCurrencyConfig(merchant)
  );
  // This static shell is shared by the canonical domain, custom/subdomain
  // aliases, and the platform's /ogabassey path. A request-relative prefix
  // cannot be correct for all of those origins without pulling headers() onto
  // the critical path. Canonical absolute PDP links are origin-independent and
  // remain correct before hydration in every alias context.
  const slides = buildLaunchSlides(products, buildStoreUrl(merchant));
  return { status: 'published', merchantId: merchant.id, slides };
}

/**
 * Cached-only slide lookup for the request-gated home Hero.
 *
 * Mirrors `resolveBlogPostHeroShell`: every leg is `'use cache'`-backed
 * (`getCachedMerchant` + the launch-product lookups inside
 * `loadOgabasseyLaunchProducts`), so this is safe to await at the page root
 * under cacheComponents — it must NEVER touch request APIs
 * (`headers()`/`connection()`), which stay exclusively in
 * `ogabassey-home-page-content.tsx` (the #2479→#2637 PPR-resume hazard).
 *
 * The static shell may use the result as inert preload/fallback data, but only
 * the request-scoped publication boundary may render it as shopping UI.
 * Errors/timeouts degrade to `null`; a cold cache miss or transient query
 * failure must never take down the page.
 *
 * Twin-call contract: the committed preload slot and the static page content
 * both await this in the same render. The `'use cache'` legs dedupe to one
 * fetch, so both owners settle on the same result — a split needs backend
 * latency inside the millisecond gap between the two budget timers.
 */
export async function resolveOgabasseyHomeHeroShell(): Promise<OgabasseyHomeHeroShellResult | null> {
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const budget = new Promise<null>((resolve) => {
      budgetTimer = setTimeout(() => resolve(null), SHELL_LOOKUP_BUDGET_MS);
    });
    return await Promise.race([resolveShellSlides(), budget]);
  } catch (error) {
    unstable_rethrow(error);
    console.error('Failed to resolve home hero shell slides', { error });
    return null;
  } finally {
    clearTimeout(budgetTimer);
  }
}
