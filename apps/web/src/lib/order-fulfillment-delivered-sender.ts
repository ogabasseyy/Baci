import {
  generateOrderDeliveredEmail,
  generateOrderDeliveredText,
  generateOrderDeliveryExceptionEmail,
  generateOrderDeliveryExceptionText,
  type OrderDeliveryExceptionKind,
  orderDeliveryExceptionSubject,
} from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import {
  buildFulfillmentTrackingUrl,
  buildMerchantEmailContext,
  getFulfillmentOrderItems,
  getFulfillmentOrderNumber,
  handleFulfillmentEmailFailure,
} from '@/lib/order-fulfillment-notification-sender-helpers';
import type {
  FeatureSettingsRecord,
  FulfillmentOrderRecord,
  MerchantRecord,
  OrderFulfillmentNotificationResult,
} from '@/lib/order-fulfillment-notification-types';
import { resolveOrderNotificationRecipient } from '@/lib/order-notification-recipient';
import { sendEmail } from '@/lib/zeptomail';

interface SendDeliveredNotificationParams {
  beforeProviderDispatch?: () => Promise<void>;
  resetProviderDispatch?: () => Promise<void>;
  featureSettings: FeatureSettingsRecord | null;
  merchant: MerchantRecord;
  merchantId: string;
  order: FulfillmentOrderRecord;
}

export async function sendDeliveredNotification({
  beforeProviderDispatch,
  featureSettings,
  merchant,
  merchantId,
  order,
  resetProviderDispatch,
}: SendDeliveredNotificationParams): Promise<OrderFulfillmentNotificationResult> {
  const hasGoogleRating = Boolean(featureSettings?.google_place_id);
  const recipient = resolveOrderNotificationRecipient(order.customer_email);
  if (!recipient.ok) {
    logger.warn({
      message:
        'Skipping delivered email because order has no valid customer email',
      orderId: order.id,
      merchantId,
      customerId: order.customer_id,
      reason: recipient.reason,
    });
    return { status: 'skipped', reason: recipient.reason, hasGoogleRating };
  }
  const { merchantUrl, replyToEmail } = buildMerchantEmailContext(merchant);
  const deliveredData = {
    orderNumber: getFulfillmentOrderNumber(order),
    customerName: order.customer_name,
    items: getFulfillmentOrderItems(order),
    merchantName: merchant.business_name,
    merchantUrl,
    supportEmail: merchant.support_email ?? undefined,
    merchantTin: merchant.tax_identification_number ?? undefined,
    merchantRcNumber: merchant.cac_rc_number ?? undefined,
    googlePlaceId: featureSettings?.google_place_id || null,
  };
  const senderName = merchant.email_sender_name || merchant.business_name;
  const emailResult = await sendEmail({
    to: recipient.email,
    clientReference: `order:${order.id}:delivered_email`,
    toName: order.customer_name,
    subject: `Your Order #${deliveredData.orderNumber} Has Been Delivered! 🎉`,
    htmlContent: generateOrderDeliveredEmail(deliveredData),
    textContent: generateOrderDeliveredText(deliveredData),
    replyTo: replyToEmail,
    emailType: 'orders',
    fromName: senderName,
    beforeTransportDispatch: beforeProviderDispatch,
    resetTransportDispatch: resetProviderDispatch,
    auditContext: {
      merchantId,
      orderId: order.id,
      customerId: order.customer_id,
      metadata: { trigger: 'order_delivered_notification' },
    },
  });
  if (!emailResult.success) {
    return handleFulfillmentEmailFailure(
      emailResult,
      order.id,
      'Failed to send delivered email'
    );
  }
  logger.info({ message: 'Order delivered email sent', orderId: order.id });
  return {
    status: 'sent',
    message: 'Delivered notification sent',
    messageId: emailResult.messageId,
    hasGoogleRating,
  };
}

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
