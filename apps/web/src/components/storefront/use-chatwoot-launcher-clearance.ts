import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Read by the Chatwoot SDK launcher (phones only, where chat opens full screen). */
export const CHATWOOT_BUBBLE_CLEARANCE_PROPERTY =
  '--cw-bubble-bottom-clearance';

// The cart page's sticky checkout bar: the native launcher sat 6.75rem above
// the screen bottom there. Chatwoot already keeps 20px (1.25rem), so lift by
// the remaining 5.5rem. The SDK applies the same value as its drag limit.
export const CHATWOOT_CART_BOTTOM_CLEARANCE = '5.5rem';

function isCartRoute(
  pathname: string | null,
  storeSlug: string | undefined
): boolean {
  const segments = pathname?.split('/').filter(Boolean);
  if (!segments?.length) return false;
  const routeIndex = segments[0] === storeSlug ? 1 : 0;
  return segments[routeIndex] === 'cart';
}

/** Lifts the launcher above the cart page's sticky bar while that page shows. */
export function useChatwootLauncherClearance(
  storeSlug: string | undefined,
  active: boolean
) {
  const pathname = usePathname();
  const lifted = active && isCartRoute(pathname, storeSlug);

  useEffect(() => {
    if (!lifted) return;
    const root = document.documentElement;
    root.style.setProperty(
      CHATWOOT_BUBBLE_CLEARANCE_PROPERTY,
      CHATWOOT_CART_BOTTOM_CLEARANCE
    );
    return () => {
      root.style.removeProperty(CHATWOOT_BUBBLE_CLEARANCE_PROPERTY);
    };
  }, [lifted]);
}
