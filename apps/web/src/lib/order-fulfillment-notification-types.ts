import type { OrderNotificationRecipientFailureReason } from '@/lib/order-notification-recipient';

export type OrderFulfillmentNotificationEventType =
  | 'order_shipped'
  | 'order_delivered'
  | 'order_delivery_failed'
  | 'order_returned';

export type OrderFulfillmentNotificationResult =
  | {
      status: 'sent';
      message: string;
      messageId?: string;
      hasGoogleRating?: boolean;
    }
  | {
      status: 'skipped';
      reason:
        | OrderNotificationRecipientFailureReason
        | 'notification_already_sent'
        | 'notification_already_skipped'
        | 'notification_delivery_outcome_unknown'
        | 'notification_pending'
        | 'notification_processing'
        | 'order_not_in_required_status';
      hasGoogleRating?: boolean;
    }
  | {
      status: 'not_found' | 'invalid_state' | 'failed';
      deliveryOutcome?: 'unknown';
      error: string;
      details?: unknown;
    };

export interface MerchantRecord {
  cac_rc_number?: string | null;
  business_name: string;
  email: string | null;
  email_sender_name: string | null;
  id: string;
  slug: string;
  support_email: string | null;
  tax_identification_number?: string | null;
}

export type FulfillmentShippingStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'canceled'
  | 'returned'
  | 'failed';

export interface FulfillmentOrderItemRecord {
  name: string | null;
  quantity: number | null;
}

export interface FulfillmentOrderRecord {
  customer_email?: string | null;
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  id: string;
  order_items: FulfillmentOrderItemRecord[] | null;
  order_number: string | null;
  shipping_address?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  shipping_provider?: string | null;
  shipping_status: FulfillmentShippingStatus;
  tracking_number?: string | null;
  tracking_token?: string | null;
}

export interface FeatureSettingsRecord {
  google_place_id: string | null;
}
