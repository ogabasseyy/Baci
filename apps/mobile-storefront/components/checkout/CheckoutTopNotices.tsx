import type { useCartCheckoutSnapshot } from '@/hooks/use-cart-checkout-snapshot';
import type { CartItem } from '@/stores/cart-store';
import { CartCheckoutReviewNotice } from './CartCheckoutReviewNotice';
import { CheckoutPrizeNotice } from './CheckoutPrizeNotice';

interface CheckoutTopNoticesProps {
  cartReview: Pick<
    ReturnType<typeof useCartCheckoutSnapshot>,
    'retry' | 'review' | 'status'
  >;
  items: CartItem[];
  simulation: boolean;
  textColor: string;
}

/** The banners shown above the checkout steps: prize notice, then cart review. */
export function CheckoutTopNotices({
  cartReview,
  items,
  simulation,
  textColor,
}: CheckoutTopNoticesProps) {
  return (
    <>
      <CheckoutPrizeNotice items={items} simulation={simulation} />
      <CartCheckoutReviewNotice
        status={cartReview.status}
        review={cartReview.review}
        onRetry={cartReview.retry}
        textColor={textColor}
      />
    </>
  );
}
