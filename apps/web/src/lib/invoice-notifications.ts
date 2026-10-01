import type { SupabaseClient } from '@supabase/supabase-js';
import {
  formatCurrency,
  type NotificationSendResult,
  notifyMerchant,
} from '@/lib/expo-push';
import { isFollowUpNotificationsEnabled } from '@/lib/follow-up-notification-preferences';
import type { Database } from '@/types/supabase';

export interface NewInvoiceNotificationOptions {
  currency?: string;
  preferenceClient: SupabaseClient<Database>;
}

/**
 * Notify a merchant that a customer created an invoice that needs follow-up.
 *
 * The preference lookup is kept with this event-specific helper so the
 * general merchant notification sender only handles delivery concerns.
 */
export async function notifyNewInvoice(
  merchantId: string,
  orderId: string,
  orderNumber: string,
  customerName: string,
  amount: number,
  options: NewInvoiceNotificationOptions
): Promise<NotificationSendResult> {
  if (
    !(await isFollowUpNotificationsEnabled(options.preferenceClient, orderId))
  ) {
    return { sent: 0, failed: 0, errors: [] };
  }

  const currency = options.currency ?? 'NGN';
  const formattedAmount = formatCurrency(amount, currency);

  return notifyMerchant(
    merchantId,
    '🧾 New Invoice',
    `Invoice #${orderNumber} created by ${customerName} for ${formattedAmount}. Follow up with the customer to collect payment.`,
    {
      type: 'new_invoice',
      order_id: orderId,
      order_number: orderNumber,
      amount,
      currency,
    },
    'orders'
  );
}
