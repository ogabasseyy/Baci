'use client';

import { useEffect } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { resolveTrackingCurrency } from '@/lib/analytics/resolve-tracking-currency';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';

type EventTrackingModule = typeof import('@/lib/event-tracking');

/**
 * Module-scope dynamic import keeps the tracker and ad-pixel helpers out of
 * the PDP's critical bundle; it loads after hydration, off the LCP path.
 */
function loadEventTracking(): Promise<EventTrackingModule> {
  return import('@/lib/event-tracking');
}

interface OgabasseyPdpProductViewTrackerProps {
  productId: string;
  name: string;
  price: number;
  category?: string;
  loadTracker?: () => Promise<EventTrackingModule>;
}

/**
 * Reports one product_view per product page to Baci (`/api/events`) and the
 * ad pixels. Renders nothing. Waits for prerender activation so a
 * speculatively prerendered PDP the shopper never opens is not counted.
 */
export function OgabasseyPdpProductViewTracker({
  productId,
  name,
  price,
  category,
  loadTracker = loadEventTracking,
}: OgabasseyPdpProductViewTrackerProps) {
  const merchant = useMerchantSafe()?.merchant;
  const merchantId = merchant?.id;
  const currency = resolveTrackingCurrency(merchant);

  useEffect(() => {
    if (!merchantId || !productId) return;
    let cancelled = false;
    const cancelActivation = runWhenPageActivated(() => {
      void loadTracker()
        .then(({ trackEvent }) => {
          if (cancelled) return;
          trackEvent.productView(
            merchantId,
            { id: productId, name, price, category },
            currency
          );
        })
        .catch(() => {
          // Analytics must never break the product page.
        });
    });
    return () => {
      cancelled = true;
      cancelActivation();
    };
  }, [merchantId, productId, name, price, category, currency, loadTracker]);

  return null;
}
