import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { env } from '@/env';
import { paidOrderAmendmentStatusSchema } from '@/lib/orders/paid-order-amendment-document';
import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';
import { sendEmail } from '@/lib/zeptomail';

const deliverySchema = z.object({
  claim: z.uuid(),
  orderId: z.uuid(),
  merchantId: z.uuid(),
  customerId: z.uuid().nullable(),
  email: z.email(),
  merchantName: z.string(),
  merchantSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  orderNumber: z.string(),
  trackingToken: z.string().nullable(),
  eventType: z.string(),
  status: paidOrderAmendmentStatusSchema,
  documentId: z.uuid(),
});

function amendmentMessage(delivery: z.infer<typeof deliverySchema>) {
  const { status } = delivery;
  if (status.state === 'reversed') {
    return 'The item change was reversed and the original items have been restored. Visit your order for the latest details.';
  }
  if (status.state === 'cancelled_for_recovery') {
    return 'Your order was cancelled. Visit your order for the latest details.';
  }
  // An email can arrive out of order after transport accepts it. Display
  // amounts, refunds and next actions only on the live order page.
  return 'An update to your order is available. View your order for the latest items, payment and fulfillment details.';
}

function deliverAmendmentUpdate(delivery: z.infer<typeof deliverySchema>) {
  const url = new URL(
    `https://${delivery.merchantSlug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}/track-order`
  );
  if (delivery.trackingToken)
    url.searchParams.set('token', delivery.trackingToken);
  else url.searchParams.set('order_id', delivery.orderId);
  const message = amendmentMessage(delivery);
  return sendEmail({
    to: delivery.email,
    fromName: delivery.merchantName,
    subject: `Order ${delivery.orderNumber} update`,
    htmlContent: `<p>${escapeHtmlText(message)}</p><p><a href="${escapeHtmlAttribute(url.href)}">View your order</a></p>`,
    textContent: `${message}\n\nView your order: ${url.href}`,
    emailType: 'orders',
    auditContext: {
      merchantId: delivery.merchantId,
      orderId: delivery.orderId,
      customerId: delivery.customerId ?? undefined,
      metadata: {
        trigger: 'paid_order_amendment_update',
        documentId: delivery.documentId,
      },
    },
  });
}

export async function drainPaidOrderAmendmentUpdates(
  client: Pick<SupabaseClient, 'rpc'>,
  deadlineMs: number
) {
  const due = await client.rpc('list_due_paid_order_amendment_updates', {
    p_limit: 10,
  });
  if (due.error) throw new Error('Unable to load amendment updates');
  const ids = z.array(z.string().regex(/^[1-9][0-9]*$/)).parse(due.data);
  for (const id of ids) {
    if (Date.now() >= deadlineMs) break;
    const claimed = await client.rpc('claim_paid_order_amendment_update', {
      p_event_id: id,
    });
    if (claimed.error) throw new Error('Unable to claim an amendment update');
    if (claimed.data === null) continue;
    const delivery = deliverySchema.safeParse(claimed.data);
    const token = z.object({ claim: z.uuid() }).safeParse(claimed.data);
    if (!token.success) continue;
    let sent = false;
    if (delivery.success) {
      try {
        sent = (await deliverAmendmentUpdate(delivery.data)).success;
      } catch {
        // The provider may already have accepted this attempt.
      }
    }
    const completion = await client.rpc(
      'complete_paid_order_amendment_update',
      {
        p_claim: token.data.claim,
        p_sent: sent,
      }
    );
    if (completion.error)
      throw new Error('Unable to complete an amendment update');
  }
}
