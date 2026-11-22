import type { PaidOrderAmendmentStatus } from '@/schemas/order-amendment-document';
import type { TrackOrderItem } from './order-item-row';

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
    | 'cancelled';
}

export interface OrderData {
  order: {
    id: string;
    amendment?: PaidOrderAmendmentStatus;
    order_number: string;
    status: string;
    payment_status: string;
    created_at: string;
    updated_at: string;
    subtotal: number;
    shipping_cost: number;
    discount_amount: number;
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
  estimated_delivery: {
    min: string;
    max: string;
  } | null;
  merchant: {
    name: string;
    logo?: string;
    support_email?: string;
    support_phone?: string;
  };
}
