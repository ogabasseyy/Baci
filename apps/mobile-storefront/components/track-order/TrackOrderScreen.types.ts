export interface TimelineEvent {
  status: string;
  title: string;
  description: string;
  timestamp: string;
  icon:
    | 'order'
    | 'payment'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'returned';
}

export interface TrackOrderItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  product_image: string | null;
}

export interface TrackOrderData {
  order: {
    id: string;
    order_number: string;
    status: string;
    payment_status: string;
    created_at: string;
    subtotal: number;
    shipping_cost: number;
    discount_amount: number;
    tax_amount?: number | null;
    gift_wrapping_fee?: number | null;
    total: number;
    currency: string;
  };
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  shipping_address: {
    address: string;
    city: string;
    state: string;
    country: string;
  };
  items: TrackOrderItem[];
  timeline: TimelineEvent[];
  shipping_tracking: {
    provider: string;
    tracking_number: string;
    tracking_url: string;
  } | null;
  estimated_delivery: string | null;
  merchant: {
    name: string;
    logo: string | null;
    support_email: string | null;
    support_phone: string | null;
  };
}
