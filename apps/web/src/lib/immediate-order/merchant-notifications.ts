import { after } from 'next/server';
import { dispatchOrderCreationNotifications } from '@/lib/order-notification-dispatch';
import type { MerchantOrderNotificationContext } from './notification-context';

export function queueMerchantOrderNotifications(
  ctx: MerchantOrderNotificationContext
) {
  after(() =>
    dispatchOrderCreationNotifications({
      merchantId: ctx.merchantId,
      orderId: ctx.orderId,
      orderNumber: ctx.orderNumber,
      customerName: ctx.customerName,
      orderTotal: ctx.orderTotal,
      orderCurrency: ctx.orderCurrency,
      paymentMethod: ctx.paymentMethod,
      paymentStatus: ctx.paymentStatus,
      invoiceBalanceDue: ctx.invoiceBalanceDue,
      isWalletFullyPaid: ctx.isWalletFullyPaid,
      preferenceClient: ctx.supabase,
    })
  );
}
