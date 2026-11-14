import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';

export type OrderDeliveryExceptionKind = 'failed' | 'returned';

interface OrderDeliveryExceptionData {
  customerName: string;
  kind: OrderDeliveryExceptionKind;
  merchantName: string;
  merchantUrl: string;
  orderNumber: string;
  supportEmail?: string;
  trackingUrl?: string;
}

const COPY: Record<
  OrderDeliveryExceptionKind,
  { heading: string; body: string }
> = {
  failed: {
    heading: 'We could not deliver your order',
    body: 'The delivery of your order could not be completed. The courier will usually try again, and you may be contacted to confirm your address or availability.',
  },
  returned: {
    heading: 'Your order is being returned',
    body: 'Your order could not be delivered and is being returned to the seller. Please contact the seller to arrange a new delivery or a refund.',
  },
};

export function orderDeliveryExceptionSubject(
  kind: OrderDeliveryExceptionKind,
  orderNumber: string
): string {
  return kind === 'failed'
    ? `Delivery problem with your order #${orderNumber}`
    : `Your order #${orderNumber} is being returned`;
}

export function generateOrderDeliveryExceptionEmail(
  data: OrderDeliveryExceptionData
): string {
  const copy = COPY[data.kind];
  const track = data.trackingUrl
    ? `<p><a href="${escapeHtmlAttribute(data.trackingUrl)}" style="color:#2563eb;">Track your order</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><body style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:0 auto;padding:24px;">
<h2 style="margin:0 0 12px;">${escapeHtmlText(copy.heading)}</h2>
<p>Hi ${escapeHtmlText(data.customerName)},</p>
<p>Order #${escapeHtmlText(data.orderNumber)} from ${escapeHtmlText(data.merchantName)}: ${escapeHtmlText(copy.body)}</p>
${track}
<p>Questions? ${data.supportEmail ? `Email ${escapeHtmlText(data.supportEmail)} or ` : ''}visit <a href="${escapeHtmlAttribute(data.merchantUrl)}">${escapeHtmlText(data.merchantName)}</a>.</p>
</body></html>`;
}

export function generateOrderDeliveryExceptionText(
  data: OrderDeliveryExceptionData
): string {
  const copy = COPY[data.kind];
  return [
    copy.heading,
    '',
    `Hi ${data.customerName},`,
    `Order #${data.orderNumber} from ${data.merchantName}: ${copy.body}`,
    data.trackingUrl ? `Track your order: ${data.trackingUrl}` : '',
    data.supportEmail ? `Support: ${data.supportEmail}` : '',
    data.merchantUrl,
  ]
    .filter(Boolean)
    .join('\n');
}
