'use client';

import { useRouter } from 'next/navigation';
import { usePrivateSearchParamsState } from '@/hooks/use-private-search-params';
import { stashPrivateParamsForNavigation } from '@/lib/privacy/private-url-param-handoff';
import { asRoute } from '@/lib/routes';
import { checkoutHref } from '../checkout-href';
import { navigateCheckoutResult } from '../navigate-checkout-result';

/**
 * Checkout navigation wiring: the private search params (`isReady` is false
 * only while hydrating a reloaded link), storefront hrefs, and the two pushes
 * that can carry an order token or shopper details. Both pushes hand those
 * values to the next page off the URL (see the hand-off helper).
 */
export function useCheckoutNavigation({
  basePath,
  isCartHydrated,
  merchantSlug,
}: {
  basePath: string | undefined;
  isCartHydrated: boolean;
  merchantSlug: string | undefined;
}) {
  const router = useRouter();
  const { searchParams, isReady } = usePrivateSearchParamsState();
  const getHref = (path: string) => checkoutHref(basePath, path);
  const handOff = (url: string) =>
    stashPrivateParamsForNavigation(url, merchantSlug);

  return {
    searchParams,
    // Also waits for the stashed order values on a hydrating load.
    isHydrated: isCartHydrated && isReady,
    getHref,
    routerPush: (url: string) => router.push(asRoute(handOff(url))),
    pushSuccessRoute: (url: string) =>
      navigateCheckoutResult(
        handOff(url),
        (path) => router.push(asRoute(path)),
        (path) => window.location.assign(path)
      ),
  };
}
