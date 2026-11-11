import {
  generateOrderCancellationEmail,
  generateOrderCancellationText,
} from '@/lib/email-templates';

interface CancellationEmailOrder {
  amount_paid: number | null;
  cancellation_refund_mode?: string | null;
  currency: string | null;
  customer_email: string;
  customer_id: string | null;
  customer_name: string | null;
  id: string;
  order_items: Array<{
    name: string | null;
    price: number | null;
    quantity: number | null;
  }> | null;
  order_number: string | null;
  total: number;
}

interface CancellationEmailMerchant {
  business_name: string;
  cac_rc_number: string | null;
  email: string;
  email_sender_name: string | null;
  id: string;
  slug: string;
  support_email: string | null;
  tax_identification_number: string | null;
}

export function buildOrderCancellationEmailMessage({
  cancelledBy,
  merchant,
  order,
  reason,
  refundAmount,
}: {
  cancelledBy: 'merchant' | 'customer';
  merchant: CancellationEmailMerchant;
  order: CancellationEmailOrder;
  reason?: string;
  refundAmount: number;
}) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const data = {
    orderNumber,
    customerName: order.customer_name || 'Customer',
    items: (order.order_items ?? []).map((item) => ({
      name: item.name || 'Product',
      price: item.price || 0,
      quantity: item.quantity || 1,
    })),
    totalAmount: Number(order.total) || 0,
    amountPaid: Number(order.amount_paid) || 0,
    refundAmount,
    cancellationReason: reason,
    cancelledBy,
    merchantName: merchant.business_name,
    merchantUrl: `https://${merchant.slug}.${rootDomain}`,
    currency: order.currency || 'NGN',
    supportEmail: merchant.support_email ?? undefined,
    merchantTin: merchant.tax_identification_number ?? undefined,
    merchantRcNumber: merchant.cac_rc_number ?? undefined,
  };
  return {
    auditContext: {
      merchantId: merchant.id,
      orderId: order.id,
      customerId: order.customer_id,
      metadata: { trigger: 'order_cancelled_notification', cancelledBy },
    },
    emailType: 'orders' as const,
    fromName: merchant.email_sender_name || merchant.business_name,
    htmlContent: generateOrderCancellationEmail(data),
    replyTo:
      merchant.support_email ||
      merchant.email ||
      `support@${merchant.slug}.${rootDomain}`,
    subject: `Order #${orderNumber} Has Been Cancelled`,
    textContent: generateOrderCancellationText(data),
    to: order.customer_email,
    toName: order.customer_name ?? undefined,
  };
}
