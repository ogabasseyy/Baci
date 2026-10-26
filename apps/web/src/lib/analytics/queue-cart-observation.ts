import { getAdTrackingData } from '@/lib/ad-tracking-cookies';
import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import type { Product } from '@/lib/products';

/** One ledger identity carries all allowed destinations, avoiding conflicting retries. */
export async function queueCartObservation(
  products: { product: Product; quantity: number }[],
  currency: string,
  eventId: string,
  merchantId: string
): Promise<void> {
  const analytics = isAnalyticsAllowed();
  const marketing = isMarketingAllowed();
  if (!analytics && !marketing) return;
  const tracking = getAdTrackingData();
  try {
    const response = await fetch('/api/analytics/conversion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: 'view_item',
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        event_source: 'web',
        merchant_id: merchantId,
        analytics_consent: analytics,
        marketing_consent: marketing,
        targets: [
          ...(analytics ? ['facebook'] : []),
          ...(marketing ? ['tiktok', 'snapchat'] : []),
        ],
        user_data: {
          ...(analytics ? { fbp: tracking.fbp } : {}),
          ...(marketing
            ? {
                ttclid: tracking.ttclid,
                ttp: tracking.ttp,
                sccid: tracking.sccid,
              }
            : {}),
        },
        custom_data: {
          currency,
          value: products.reduce(
            (sum, item) => sum + item.product.price * item.quantity,
            0
          ),
          url: window.location.href,
          contents: products.map(({ product, quantity }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity,
          })),
        },
      }),
    });
    if (!response.ok) console.warn('Cart observation was not accepted');
  } catch {
    console.warn('Cart observation could not be queued');
  }
}
