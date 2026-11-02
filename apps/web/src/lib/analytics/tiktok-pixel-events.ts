import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { isMarketingAllowed } from '@/lib/marketing-consent';

export const tiktokEvents = {
  /** Product view. */
  viewContent: (
    productId: string,
    productName: string,
    price: number,
    currency: string = 'USD',
    eventId?: string,
    products?: Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
    }>
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('tiktok')?.ready ||
      typeof window === 'undefined' ||
      !window.ttq?.instance
    )
      return;

    window.ttq.instance?.(socialPixelContext.get('tiktok')?.id ?? '').track(
      'ViewContent',
      {
        content_id: productId,
        content_ids: products?.map((product) => product.id) ?? [productId],
        contents: products?.map((product) => ({
          content_id: product.id,
          content_name: product.name,
          price: product.price,
          quantity: product.quantity,
        })),
        content_name: productName,
        content_type: 'product',
        price,
        value: price,
        currency,
      },
      { event_id: eventId }
    );
  },

  /** Add to cart. */
  addToCart: (
    productId: string,
    productName: string,
    price: number,
    quantity: number = 1,
    currency: string = 'USD',
    eventId?: string
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('tiktok')?.ready ||
      typeof window === 'undefined' ||
      !window.ttq?.instance
    )
      return;

    window.ttq.instance?.(socialPixelContext.get('tiktok')?.id ?? '').track(
      'AddToCart',
      {
        content_id: productId,
        content_name: productName,
        content_type: 'product',
        price,
        quantity,
        value: price * quantity,
        currency,
      },
      { event_id: eventId }
    );
  },

  /**
   * Track checkout initiation
   */
  initiateCheckout: (
    value: number,
    currency: string = 'USD',
    productIds: string[] = [],
    eventId?: string
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('tiktok')?.ready ||
      typeof window === 'undefined' ||
      !window.ttq?.instance
    )
      return;

    window.ttq.instance?.(socialPixelContext.get('tiktok')?.id ?? '').track(
      'InitiateCheckout',
      {
        content_ids: productIds,
        content_type: 'product',
        value,
        currency,
      },
      { event_id: eventId }
    );
  },

  /**
   * Track purchase completion
   */
  purchase: (
    _orderId: string,
    value: number,
    currency: string,
    products: Array<{ id: string; price: number; quantity: number }>
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('tiktok')?.ready ||
      typeof window === 'undefined' ||
      !window.ttq?.instance
    )
      return;

    window.ttq
      .instance?.(socialPixelContext.get('tiktok')?.id ?? '')
      .track('CompletePayment', {
        content_ids: products.map((p) => p.id),
        content_type: 'product',
        value,
        currency,
        contents: products.map((p) => ({
          content_id: p.id,
          price: p.price,
          quantity: p.quantity,
        })),
      });
  },

  /**
   * Track search
   */
  search: (searchTerm: string) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('tiktok')?.ready ||
      typeof window === 'undefined' ||
      !window.ttq?.instance
    )
      return;

    window.ttq
      .instance?.(socialPixelContext.get('tiktok')?.id ?? '')
      .track('Search', {
        query: searchTerm,
      });
  },

  /**
   * Identify user with hashed data for advanced matching
   */
  identify: (email?: string, phone?: string, externalId?: string) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('tiktok')?.ready ||
      typeof window === 'undefined' ||
      !window.ttq?.instance
    )
      return;

    const identifyData: Record<string, string> = {};
    if (email) identifyData.email = email; // TikTok handles hashing
    if (phone) identifyData.phone_number = phone;
    if (externalId) identifyData.external_id = externalId;

    if (Object.keys(identifyData).length > 0) {
      window.ttq
        .instance?.(socialPixelContext.get('tiktok')?.id ?? '')
        .identify(identifyData);
    }
  },
};
