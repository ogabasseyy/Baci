import {
  generateOrderDeliveryExceptionEmail,
  generateOrderDeliveryExceptionText,
  type OrderDeliveryExceptionKind,
  orderDeliveryExceptionSubject,
} from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import {
  buildFulfillmentTrackingUrl,
  buildMerchantEmailContext,
  getFulfillmentOrderNumber,
  handleFulfillmentEmailFailure,
} from '@/lib/order-fulfillment-notification-sender-helpers';
import type {
  FulfillmentOrderRecord,
  MerchantRecord,
  OrderFulfillmentNotificationResult,
} from '@/lib/order-fulfillment-notification-types';
import { resolveOrderNotificationRecipient } from '@/lib/order-notification-recipient';
import { sendEmail } from '@/lib/zeptomail';

interface SendDeliveryExceptionParams {
  beforeProviderDispatch?: () => Promise<void>;
  kind: OrderDeliveryExceptionKind;
  merchant: MerchantRecord;
  merchantId: string;
  order: FulfillmentOrderRecord;
  resetProviderDispatch?: () => Promise<void>;
}

/** Customer email for a failed delivery attempt or a returned GIG parcel. */
export async function sendDeliveryExceptionNotification({
  beforeProviderDispatch,
  kind,
  merchant,
  merchantId,
  order,
  resetProviderDispatch,
}: SendDeliveryExceptionParams): Promise<OrderFulfillmentNotificationResult> {
  const recipient = resolveOrderNotificationRecipient(order.customer_email);
  if (!recipient.ok) {
    logger.warn({
      message: 'Skipping delivery exception email: no valid customer email',
      orderId: order.id,
      merchantId,
      reason: recipient.reason,
    });
    return { status: 'skipped', reason: recipient.reason };
  }
  const { merchantUrl, replyToEmail, rootDomain } =
    buildMerchantEmailContext(merchant);
  const data = {
    customerName: order.customer_name,
    kind,
    merchantName: merchant.business_name,
    merchantUrl,
    orderNumber: getFulfillmentOrderNumber(order),
    supportEmail: merchant.support_email ?? undefined,
    trackingUrl: buildFulfillmentTrackingUrl(
      rootDomain,
      merchant.slug,
      order,
      order.tracking_number ?? undefined
    ),
  };
  const emailResult = await sendEmail({
    to: recipient.email,
    clientReference: `order:${order.id}:${kind === 'failed' ? 'delivery_failed' : 'returned'}_email`,
    toName: order.customer_name,
    subject: orderDeliveryExceptionSubject(kind, data.orderNumber),
    htmlContent: generateOrderDeliveryExceptionEmail(data),
    textContent: generateOrderDeliveryExceptionText(data),
    replyTo: replyToEmail,
    emailType: 'orders',
    fromName: merchant.email_sender_name || merchant.business_name,
    beforeTransportDispatch: beforeProviderDispatch,
    resetTransportDispatch: resetProviderDispatch,
    auditContext: {
      merchantId,
      orderId: order.id,
      customerId: order.customer_id,
      metadata: { trigger: `order_${kind}_notification` },
    },
  });
  if (!emailResult.success) {
    return handleFulfillmentEmailFailure(
      emailResult,
      order.id,
      'Failed to send delivery exception email'
    );
  }
  return {
    status: 'sent',
    message: 'Delivery exception notification sent',
    messageId: emailResult.messageId,
  };
}
