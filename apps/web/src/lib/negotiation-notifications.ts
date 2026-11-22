/**
 * Negotiation push notification helpers.
 *
 * Extracted from expo-push.ts to respect the one-utility-per-file convention.
 */

import {
  formatCurrency,
  type NotificationSendResult,
  notifyCustomer,
  notifyMerchant,
} from '@/lib/expo-push';
import { sendEmail } from '@/lib/zeptomail';

const HTML_TEXT_ESCAPE_REGEX = /[&<>]/g;
const HTML_TEXT_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtmlText(value: string): string {
  return value.replace(
    HTML_TEXT_ESCAPE_REGEX,
    (match) => HTML_TEXT_ESCAPE_MAP[match]
  );
}

/**
 * Notify merchant of a new price negotiation request.
 *
 * Handles both `type='single'` (single item with name/price) and `type='total'`
 * (cart-level negotiation where `item_info` is null).
 */
export async function notifyNegotiationRequest(
  merchantId: string,
  negotiationType: 'single' | 'total',
  offeredPrice: number,
  negotiationId: string,
  itemName?: string | null,
  currentPrice?: number | null
): Promise<void> {
  const formattedOffer = formatCurrency(offeredPrice);

  let body: string;
  if (negotiationType === 'total' || !itemName || currentPrice == null) {
    body = `Cart total negotiation — ${formattedOffer} offered`;
  } else {
    const discount =
      currentPrice > 0
        ? Math.round(((currentPrice - offeredPrice) / currentPrice) * 100)
        : 0;
    body =
      discount > 0
        ? `${itemName} — ${formattedOffer} offered (${discount}% off)`
        : `${itemName} — ${formattedOffer} offered`;
  }

  await notifyMerchant(
    merchantId,
    '🤝 New Price Negotiation',
    body,
    { type: 'negotiation', negotiation_id: negotiationId },
    'orders'
  );
}

/**
 * Notify customer of a negotiation response (accepted/rejected).
 *
 * Handles both single-item and cart-level negotiations.
 */
export function notifyNegotiationResponse(
  userId: string,
  negotiationType: 'single' | 'total',
  status: 'accepted' | 'rejected' | 'countered',
  negotiationId: string,
  itemName?: string | null,
  offeredPrice?: number | null,
  productSlug?: string | null
): Promise<NotificationSendResult> {
  const isAccepted = status === 'accepted';
  const title =
    status === 'countered'
      ? '🤝 New Counter Offer'
      : isAccepted
        ? '✅ Offer Accepted!'
        : '❌ Offer Declined';

  let body: string;
  if (negotiationType === 'total' || !itemName) {
    body = isAccepted
      ? 'Your cart offer has been accepted! Complete your purchase now.'
      : 'Your cart offer was declined. Try a new offer or buy at the listed price.';
  } else {
    const formattedPrice =
      offeredPrice != null ? formatCurrency(offeredPrice) : '';

    body = isAccepted
      ? `Your offer${formattedPrice ? ` of ${formattedPrice}` : ''} for ${itemName} has been accepted!`
      : `Your offer for ${itemName} was declined. Try a new offer or buy at the listed price.`;
  }

  if (status === 'countered') {
    body = `You received a counter offer of ${formatCurrency(offeredPrice ?? 0)} for ${negotiationType === 'total' ? 'your cart' : (itemName ?? 'your item')}. Contact the store about this price or submit a new offer to keep negotiating.`;
  }

  return notifyCustomer(
    userId,
    title,
    body,
    {
      type: 'negotiation_response',
      negotiation_id: negotiationId,
      status,
      ...(status === 'countered' ? { counter_offer: offeredPrice } : {}),
      ...(productSlug ? { product_slug: productSlug } : {}),
    },
    'orders'
  );
}

interface NotifyGuestNegotiationResponseEmailParams {
  acceptedPrice?: number | null;
  email: string;
  itemName?: string | null;
  merchantId: string;
  negotiationId: string;
  negotiationType: 'single' | 'total';
  productSlug?: string | null;
  status: 'accepted' | 'rejected' | 'countered';
}

export async function notifyGuestNegotiationResponseByEmail({
  acceptedPrice,
  email,
  itemName,
  merchantId,
  negotiationId,
  negotiationType,
  productSlug,
  status,
}: NotifyGuestNegotiationResponseEmailParams): Promise<void> {
  const isAccepted = status === 'accepted';
  const formattedPrice =
    acceptedPrice != null ? formatCurrency(acceptedPrice) : null;
  const subject =
    status === 'countered'
      ? 'You received a counter offer'
      : isAccepted
        ? 'Your offer has been accepted'
        : 'Your offer was declined';
  const itemLabel =
    negotiationType === 'total' || !itemName ? 'your cart offer' : itemName;
  const decisionText =
    status === 'countered'
      ? `You received a counter offer of ${formattedPrice} for ${itemLabel}.`
      : isAccepted
        ? `Your offer${formattedPrice ? ` of ${formattedPrice}` : ''} for ${itemLabel} has been accepted.`
        : `Your offer for ${itemLabel} was declined. You can return to the store to make another offer or buy at the listed price.`;
  const actionText =
    status === 'countered'
      ? 'Contact the store about this price or submit a new offer to keep negotiating.'
      : isAccepted
        ? 'Return to the store to complete your purchase.'
        : 'Return to the store to continue shopping.';
  const escapedDecisionText = escapeHtmlText(decisionText);
  const escapedActionText = escapeHtmlText(actionText);

  const result = await sendEmail({
    auditContext: {
      merchantId,
      metadata: {
        negotiationId,
        productSlug: productSlug ?? null,
        status,
      },
    },
    emailType: 'orders',
    htmlContent: `
      <p>${escapedDecisionText}</p>
      <p>${escapedActionText}</p>
    `,
    merchantId,
    subject,
    textContent: `${decisionText}\n\n${actionText}`,
    to: email,
  });

  if (!result.success) {
    throw new Error(
      result.error || 'Failed to send negotiation response email'
    );
  }
}
