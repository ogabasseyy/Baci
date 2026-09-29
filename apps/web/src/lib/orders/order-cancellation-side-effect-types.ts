import type { buildOrderCancellationEmailMessage } from '@/lib/orders/build-order-cancellation-email-message';

export type CancellationOrder = Parameters<
  typeof buildOrderCancellationEmailMessage
>[0]['order'] & {
  currency: string | null;
  merchant_id: string;
  payment_status: string;
};

export type CancellationMerchant = Parameters<
  typeof buildOrderCancellationEmailMessage
>[0]['merchant'];

export type CancellationEmailMessage = ReturnType<
  typeof buildOrderCancellationEmailMessage
>;

export type CancellationEmailResult = {
  deliveryOutcome?: 'unknown';
  error?: string;
  messageId?: string;
  success: boolean;
};

export type CancellationEmailSender = (
  message: CancellationEmailMessage & {
    signal?: AbortSignal;
    fallbackDeadlineMs?: number;
    maxAttemptsPerSender?: number;
  }
) => Promise<CancellationEmailResult>;
