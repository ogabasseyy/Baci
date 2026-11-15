import { AdUnit } from '../components/AdUnit';

/**
 * The ad shown under the cart items. It reuses the product-grid ad unit, so it
 * carries its own slot instance to stay separate from grid ads on the page.
 */
export function CartInFeedAd() {
  return <AdUnit placementKey="PRODUCT_GRID_MPU" slotInstance="cart" />;
}
