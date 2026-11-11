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

export interface ProductEvent extends BaseEvent {
  product_id: string;
  product_name: string;
  product_category?: string;
  product_price: number;
  quantity?: number;
  currency: string;
}

export interface PurchaseEvent extends BaseEvent {
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
  search_term: string;
  results_count?: number;
}

export type TrackedEvent =
  | BaseEvent
  | ProductEvent
  | PurchaseEvent
  | SearchEvent;
