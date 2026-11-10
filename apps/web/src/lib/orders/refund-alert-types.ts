import type { SupabaseClient } from '@supabase/supabase-js';

export interface RefundReviewAlertOrder {
  currency: string | null;
  id: string;
  merchant_id: string;
  order_number: string | null;
}

export interface RefundReviewAlertMerchant {
  email: string | null;
  id: string;
}

export interface RefundReviewAlertSenders {
  sendEmail: (message: {
    emailType: 'notifications';
    htmlContent: string;
    subject: string;
    textContent: string;
    to: string;
    auditContext: {
      merchantId: string;
      metadata: Record<string, string>;
      orderId: string;
    };
  }) => Promise<{ deliveryOutcome?: 'unknown'; success: boolean }>;
  sendPush: (
    merchantId: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
    channelId: 'payments'
  ) => Promise<{
    deliveryOutcome?: 'unknown';
    errors?: string[];
    failed?: number;
    sent: number;
  }>;
}

/** Ledger state of a review whose earlier alert was never confirmed. */
export interface PriorAlertAttempt {
  attempts: number;
}

export type AlertSupabase = Pick<SupabaseClient, 'from' | 'rpc'>;

export type ChannelOutcome =
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'timeout'
  | 'uncertain'
  | 'undeliverable';

export interface RefundAlertPassSummary {
  alerted: number;
  attempted: number;
  deferred: number;
  duplicate: number;
  failed: number;
  uncertain: number;
  undeliverable: number;
}
