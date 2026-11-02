import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { isMarketingAllowed } from '@/lib/marketing-consent';

export const snapchatEvents = {
  /** Product view. */
  viewContent: (
    productId: string,
    price: number,
    currency: string = 'USD',
    eventId?: string,
    productIds: string[] = [productId]
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'VIEW_CONTENT',
      {
        item_ids: productIds,
        price,
        currency,
        client_dedup_id: eventId,
      }
    );
  },

  /** Add to cart. */
  addToCart: (
    productId: string,
    price: number,
    currency: string = 'USD',
    eventId?: string,
    quantity = 1
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'ADD_CART',
      {
        item_ids: [productId],
        price: price * quantity,
        number_items: quantity,
        currency,
        client_dedup_id: eventId,
      }
    );
  },

  /**
   * Track checkout initiation
   */
  startCheckout: (
    value: number,
    currency: string = 'USD',
    productIds: string[] = [],
    eventId?: string
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'START_CHECKOUT',
      {
        item_ids: productIds,
        price: value,
        currency,
        client_dedup_id: eventId,
      }
    );
  },

  /**
   * Track purchase completion
   */
  purchase: (
    orderId: string,
    value: number,
    currency: string = 'USD',
    productIds: string[] = []
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'PURCHASE',
      {
        item_ids: productIds,
        price: value,
        currency,
        transaction_id: orderId,
      }
    );
  },

  /**
   * Track search
   */
  search: (searchTerm: string) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'SEARCH',
      {
        search_string: searchTerm,
      }
    );
  },

  /**
   * Track sign up
   */
  signUp: () => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'SIGN_UP'
    );
  },

  /**
   * Set user data for advanced matching
   * Note: User data should be set during pixel initialization.
   * This is called automatically if you pass user data to the PAGE_VIEW event.
   */
  setUserData: (pixelId: string, email?: string, phone?: string) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    const userData: Record<string, string> = {};
    if (email) userData.user_email = email;
    if (phone) userData.user_phone_number = phone;

    if (Object.keys(userData).length > 0) {
      // Re-initialize with user data
      window.snaptr('init', pixelId, userData);
    }
  },
};
