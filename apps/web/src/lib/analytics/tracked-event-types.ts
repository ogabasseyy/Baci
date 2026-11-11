/** Shapes of the browser funnel events posted to `/api/events`. */

// Event types for the database
export type EventType =
  | 'page_view'
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'begin_checkout'
  | 'purchase'
  | 'search'
  | 'add_to_wishlist'
  | 'share';

export interface BaseEvent {
  event_type: EventType;
  event_id?: string;
  merchant_id: string;
  session_id?: string;
  user_agent?: string;
  referrer?: string;
  page_url?: string;
}

/** Events that carry no payload beyond the common fields. */
export interface PageViewEvent extends BaseEvent {
  event_type: 'page_view' | 'share';
}

export interface ProductEvent extends BaseEvent {
  event_type:
    | 'product_view'
    | 'add_to_cart'
    | 'remove_from_cart'
    | 'add_to_wishlist';
  product_id: string;
  product_name: string;
  product_category?: string;
  product_price: number;
  quantity?: number;
  currency: string;
}

export interface PurchaseEvent extends BaseEvent {
  event_type: 'begin_checkout' | 'purchase';
  order_id: string;
  total: number;
  subtotal: number;
  shipping?: number;
  tax?: number;
  currency: string;
  item_count: number;
  items: Array<{
    product_id: string;
    product_name: string;
    price: number;
    quantity: number;
  }>;
}

export interface SearchEvent extends BaseEvent {
  event_type: 'search';
  search_term: string;
  results_count?: number;
}

/**
 * Discriminated by `event_type`: a funnel event (add_to_cart,
 * begin_checkout, ...) must carry its full product or order payload.
 */
export type TrackedEvent =
  | PageViewEvent
  | ProductEvent
  | PurchaseEvent
  | SearchEvent;
