import type { SupabaseClient } from '@supabase/supabase-js';
import {
  notifyNewInvoice,
  notifyNewOrder,
  notifyPaymentReceived,
} from '@/lib/expo-push';
import { logger } from '@/lib/logger';
import type { Database } from '@/types/supabase';

export interface OrderCreationNotificationInput {
  merchantId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderTotal: number;
  orderCurrency: string;
  paymentMethod: string;
  paymentStatus: string | null | undefined;
  invoiceBalanceDue: number;
  isWalletFullyPaid: boolean;
  preferenceClient: SupabaseClient<Database>;
}

/**
 * Dispatch the merchant-side notifications that follow order creation.
 *
 * Invoice alerts are only for an unpaid invoice with a positive balance. The
 * route still sends the invoice email for zero-value invoices, but those do
 * not create a payment-collection follow-up item.
 */
export async function dispatchOrderCreationNotifications(
  input: OrderCreationNotificationInput
): Promise<void> {
  const isInvoiceCreation = input.paymentMethod === 'invoice';

  try {
    const invoiceNeedsFollowUp =
      input.invoiceBalanceDue > 0 && input.paymentStatus !== 'paid';
    const pushResult = isInvoiceCreation
      ? invoiceNeedsFollowUp
        ? await notifyNewInvoice(
            input.merchantId,
            input.orderId,
            input.orderNumber,
            input.customerName,
            input.invoiceBalanceDue,
            {
              currency: input.orderCurrency,
              preferenceClient: input.preferenceClient,
            }
          )
        : undefined
      : await notifyNewOrder(
          input.merchantId,
          input.orderId,
          input.orderNumber,
          input.customerName,
          input.orderTotal,
          input.orderCurrency
        );

    if (pushResult && (pushResult.failed > 0 || pushResult.errors.length > 0)) {
      logger.warn({
        message: isInvoiceCreation
          ? 'New invoice push notification was not fully delivered'
          : 'New order push notification was not fully delivered',
        orderId: input.orderId,
        merchantId: input.merchantId,
        sent: pushResult.sent,
        failed: pushResult.failed,
        errors: pushResult.errors,
      });
    }
  } catch (err) {
    logger.error({ message: 'Push notification failed', error: err });
  }

  if (!input.isWalletFullyPaid) {
    return;
  }

  try {
    const paymentPushResult = await notifyPaymentReceived(
      input.merchantId,
      input.orderTotal,
      input.orderCurrency,
      input.orderNumber,
      input.orderId
    );
    if (paymentPushResult.failed > 0 || paymentPushResult.errors.length > 0) {
      logger.warn({
        message: 'Payment push notification was not fully delivered',
        orderId: input.orderId,
        merchantId: input.merchantId,
        sent: paymentPushResult.sent,
        failed: paymentPushResult.failed,
        errors: paymentPushResult.errors,
      });
    }
  } catch (err) {
    logger.error({
      message: 'Payment push notification failed',
      error: err,
    });
  }
}
