import type Expo from 'expo-server-sdk';
import type { DeliveryStartOptions } from './expo-push-chunk-delivery';
import type { PushStore } from './push-store';

export interface NotificationSendResult {
  sent: number;
  failed: number;
  errors: string[];
  /** The provider call or ticket processing may have delivered a push. */
  deliveryOutcome?: 'unknown';
  /** Tokens whose ticket was accepted, for retrying only the failed subset. */
  succeededTokens?: string[];
}

/**
 * Notification channel types for Android
 */
export type NotificationChannel =
  | 'orders'
  | 'payments'
  | 'stock'
  | 'general'
  | 'admin'
  | 'promotions';

export type MerchantNotificationOptions = DeliveryStartOptions & {
  /** Skip these tokens (already delivered on an earlier partial attempt). */
  excludeTokens?: string[];
  /**
   * Restrict delivery to tokens registered by these users (owner plus
   * permitted staff). An empty list delivers to nobody.
   */
  recipientUserIds?: string[];
};

// ── Core send functions ──────────────────────────────────────────────────────

export interface TicketContext {
  merchantId?: string;
  userId?: string;
  appType?: 'admin' | 'storefront';
  channel?: string;
  notificationType?: string;
  /**
   * Carried from the chunk-delivery catch path: a provider request
   * threw without a definitive response. Never inferred from ticket
   * error codes — Expo's own `ExpoError` tickets are definitive.
   */
  deliveryUncertain?: boolean;
}

export interface PushAttemptContext extends TicketContext {
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  tokenCount: number;
  result: NotificationSendResult;
}

/** A push store plus the Expo client used to deliver. */
export interface PushDelivery extends PushStore {
  getExpo(): Expo;
}
