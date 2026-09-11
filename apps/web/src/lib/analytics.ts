'use client';

import type { Product } from '@/lib/products';
import { facebookCatalogEvent } from './facebook-catalog-event';

// Types for analytics events
interface EcommerceItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_brand?: string;
  price: number;
  quantity?: number;
  item_variant?: string;
}

interface ViewItemParams {
  currency: string;
  value: number;
  items: EcommerceItem[];
}

interface AddToCartParams {
  currency: string;
  value: number;
  items: EcommerceItem[];
}

interface PurchaseParams {
  transaction_id: string;
  currency: string;
  value: number;
  tax?: number;
  shipping?: number;
  items: EcommerceItem[];
}

// Window type extension for gtag and fbq is in consent-mode.ts

// Check if analytics cookies are allowed
export function isAnalyticsAllowed(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const consent = localStorage.getItem('baci-cookie-consent');
    if (!consent) return false;

    const parsed = JSON.parse(consent);
    return parsed.analytics === true;
  } catch {
    return false;
  }
}

// Convert product to ecommerce item format
function productToItem(
  product: Product,
  quantity: number = 1,
  variant?: string
): EcommerceItem {
  // Use joined categories.name from category_id, fallback to legacy TEXT field
  const categoryName =
    product.categories?.name || product.category || undefined;

  return {
    item_id: product.id,
    item_name: product.name,
    item_category: categoryName,
    price: product.price,
    quantity,
    item_variant: variant,
  };
}

// GA4 Event Tracking
function sendGA4Event(eventName: string, params: object) {
  if (!isAnalyticsAllowed()) return;
  if (typeof window === 'undefined' || !window.gtag) return;

  window.gtag('event', eventName, params);
}

// Facebook Pixel Event Tracking
function sendFBEvent(eventName: string, params?: object) {
  if (!isAnalyticsAllowed()) return;
  if (typeof window === 'undefined' || !window.fbq) return;

  if (params) {
    window.fbq('track', eventName, facebookCatalogEvent(params));
  } else {
    window.fbq('track', eventName);
  }
}

// Helper to dispatch server-side CAPI events
async function dispatchCAPI(
  provider: 'facebook-capi' | 'snapchat',
  payload: object
) {
  try {
    const response = await fetch(`/api/analytics/${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      console.warn(provider, 'CAPI dispatch failed:', response.statusText);
    }
  } catch (err) {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
    console.warn(provider, 'CAPI dispatch error:', err);
  }
}

// Analytics tracking functions
export const analytics = {
  // Page view
  pageView: (url: string, title?: string) => {
    // GA4 - page_view is automatic with gtag.js, but can be manual
    sendGA4Event('page_view', {
      page_location: url,
      page_title: title,
    });

    // FB Pixel - PageView is automatic, but can track custom
    sendFBEvent('PageView');
  },

  // View product details
  viewItem: (product: Product, currency: string = 'USD') => {
    const params: ViewItemParams = {
      currency,
      value: product.price,
      items: [productToItem(product)],
    };

    sendGA4Event('view_item', params);

    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName = product.categories?.name || product.category || '';

    sendFBEvent('ViewContent', {
      content_ids: [product.id],
      content_name: product.name,
      content_type: 'product',
      content_category: categoryName,
      value: product.price,
      currency,
    });
  },

  // Add to cart
  addToCart: (
    product: Product,
    quantity: number = 1,
    currency: string = 'USD',
    variant?: string
  ) => {
    const params: AddToCartParams = {
      currency,
      value: product.price * quantity,
      items: [productToItem(product, quantity, variant)],
    };

    sendGA4Event('add_to_cart', params);

    sendFBEvent('AddToCart', {
      content_ids: [product.id],
      content_name: product.name,
      content_type: 'product',
      value: product.price * quantity,
      currency,
      num_items: quantity,
    });
  },

  // Remove from cart
  removeFromCart: (
    product: Product,
    quantity: number = 1,
    currency: string = 'USD'
  ) => {
    sendGA4Event('remove_from_cart', {
      currency,
      value: product.price * quantity,
      items: [productToItem(product, quantity)],
    });
  },

  // View cart (GA4 standard event + CAPI)
  viewCart: (
    products: Array<{ product: Product; quantity: number }>,
    currency: string = 'USD',
    additionalData?: {
      merchantId: string;
      // biome-ignore lint/suspicious/noExplicitAny: userData is intentionally flexible for analytics payloads
      userData?: any;
    }
  ) => {
    const value = products.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0
    );
    const items = products.map(({ product, quantity }) =>
      productToItem(product, quantity)
    );

    // Client-side GA4
    sendGA4Event('view_cart', {
      currency,
      value,
      items,
    });

    // Client-side FB Pixel (using InitiateCheckout as strict ViewCart doesn't exist/isn't standard)
    // Actually, widespread practice is mapping ViewCart -> ViewContent (Category: Cart) or initiateCheckout for deeper intent.
    // User requested "all CAPI structures".
    // For FB CAPI, we'll map to 'ViewContent' or 'InitiateCheckout'.
    // Given the flow sidebar -> checkout, 'InitiateCheckout' is strong.
    // However, let's stick to ViewContent for "Viewing" to avoid inflating checkout starts.
    sendFBEvent('ViewContent', {
      content_ids: products.map((p) => p.product.id),
      content_type: 'product_group',
      content_name: 'Shopping Cart',
      value,
      currency,
      num_items: products.reduce((sum, p) => sum + p.quantity, 0),
    });

    // Server-side CAPI Dispatch (if merchantId provided)
    if (additionalData?.merchantId) {
      // Facebook CAPI
      dispatchCAPI('facebook-capi', {
        event: 'ViewContent',
        merchantId: additionalData.merchantId,
        userData: additionalData.userData,
        eventData: {
          value,
          currency,
          products: products.map((p) => ({
            id: p.product.id,
            name: p.product.name,
            quantity: p.quantity,
            price: p.product.price,
          })),
        },
        eventSourceUrl: window.location.href,
      });

      // Snapchat CAPI - No direct "View Cart", usually mapped to ADD_CART or START_CHECKOUT.
      // We will skip Snapchat for *View* Cart to be safe, or could map to standard event if requested.
      // User said "all capi structures". Let's map to 'move_to_checkout' equivalent or skip if invalid.
      // Snapchat route supports: purchase, begin_checkout, add_to_cart.
      // 'view_cart' doesn't map cleanly. We'll omit to prevent error 400 from endpoint.
    }
  },

  // View cart / Begin checkout
  beginCheckout: (
    products: Array<{ product: Product; quantity: number }>,
    currency: string = 'USD'
  ) => {
    const value = products.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0
    );
    const items = products.map(({ product, quantity }) =>
      productToItem(product, quantity)
    );

    sendGA4Event('begin_checkout', {
      currency,
      value,
      items,
    });

    sendFBEvent('InitiateCheckout', {
      content_ids: products.map((p) => p.product.id),
      content_type: 'product',
      value,
      currency,
      num_items: products.reduce((sum, p) => sum + p.quantity, 0),
    });
  },

  // Add payment info (optional step)
  addPaymentInfo: (
    paymentType: string,
    currency: string = 'USD',
    value: number = 0
  ) => {
    sendGA4Event('add_payment_info', {
      currency,
      value,
      payment_type: paymentType,
    });

    sendFBEvent('AddPaymentInfo', {
      currency,
      value,
    });
  },

  // Purchase complete
  purchase: (
    orderId: string,
    products: Array<{ product: Product; quantity: number }>,
    total: number,
    currency: string = 'USD',
    tax?: number,
    shipping?: number
  ) => {
    const items = products.map(({ product, quantity }) =>
      productToItem(product, quantity)
    );

    const params: PurchaseParams = {
      transaction_id: orderId,
      currency,
      value: total,
      tax,
      shipping,
      items,
    };

    sendGA4Event('purchase', params);

    sendFBEvent('Purchase', {
      content_ids: products.map((p) => p.product.id),
      content_type: 'product',
      value: total,
      currency,
      num_items: products.reduce((sum, p) => sum + p.quantity, 0),
    });
  },

  // Search
  search: (searchTerm: string) => {
    sendGA4Event('search', {
      search_term: searchTerm,
    });

    sendFBEvent('Search', {
      search_string: searchTerm,
    });
  },

  // View item list (category page)
  viewItemList: (
    listId: string,
    listName: string,
    products: Product[],
    _currency: string = 'USD'
  ) => {
    const items = products.map((product, index) => ({
      ...productToItem(product),
      index,
      item_list_id: listId,
      item_list_name: listName,
    }));

    sendGA4Event('view_item_list', {
      item_list_id: listId,
      item_list_name: listName,
      items,
    });

    // FB doesn't have a specific event for this, but we can use ViewContent
    sendFBEvent('ViewContent', {
      content_ids: products.map((p) => p.id),
      content_type: 'product_group',
      content_category: listName,
    });
  },

  // Click on product in list
  selectItem: (
    product: Product,
    listId?: string,
    listName?: string,
    index?: number
  ) => {
    sendGA4Event('select_item', {
      item_list_id: listId,
      item_list_name: listName,
      items: [
        {
          ...productToItem(product),
          index,
        },
      ],
    });
  },

  // Add to wishlist
  addToWishlist: (product: Product, currency: string = 'USD') => {
    sendGA4Event('add_to_wishlist', {
      currency,
      value: product.price,
      items: [productToItem(product)],
    });

    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName = product.categories?.name || product.category || '';

    sendFBEvent('AddToWishlist', {
      content_ids: [product.id],
      content_name: product.name,
      content_category: categoryName,
      value: product.price,
      currency,
    });
  },

  // Sign up / Lead
  signUp: (method?: string) => {
    sendGA4Event('sign_up', { method });
    sendFBEvent('CompleteRegistration');
  },

  // Contact / Lead form submission
  generateLead: (value?: number, currency: string = 'USD') => {
    sendGA4Event('generate_lead', { value, currency });
    sendFBEvent('Lead', { value, currency });
  },
};
