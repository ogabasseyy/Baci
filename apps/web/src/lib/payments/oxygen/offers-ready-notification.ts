import 'server-only';
import { z } from 'zod';
import { sendPushNotificationChunks } from '@/lib/expo-push-chunk-delivery';
import { createLazyExpoGetter } from '@/lib/expo-push-lazy-client';
import { zeptoMailRequest } from '@/lib/zeptomail-transport';

const getExpo = createLazyExpoGetter(() => process.env.EXPO_ACCESS_TOKEN);

export const oxygenOffersRecipient = z.object({
  workflowId: z.uuid(),
  orderId: z.uuid(),
  merchantSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  email: z.string().nullable(),
  pushToken: z.string().nullable(),
});

export async function sendOxygenOffersReady(
  recipient: z.infer<typeof oxygenOffersRecipient>
): Promise<boolean> {
  const title = 'Your payment options are ready';
  const body = 'Open your saved checkout to continue your application.';
  if (recipient.pushToken) {
    const delivery = await sendPushNotificationChunks(getExpo(), [
      {
        to: recipient.pushToken,
        title,
        body,
        data: { screen: 'order-details', params: { id: recipient.orderId } },
        channelId: 'orders',
        sound: 'default',
      },
    ]);
    if (delivery.tickets.some((ticket) => ticket.status === 'ok')) return true;
    // An unknown outcome could already have reached the customer.
    if (delivery.deliveryUncertain) return false;
  }
  const email = z.email().safeParse(recipient.email);
  if (!email.success) return false;
  const url = new URL(
    `/${recipient.merchantSlug}/checkout`,
    'https://usebaci.com'
  );
  url.searchParams.set('oxygenOrderId', recipient.orderId);
  const token = process.env.ZEPTOMAIL_TOKEN?.trim();
  if (!token) return false;
  await zeptoMailRequest(
    'email',
    {
      from: {
        address: `orders@${process.env.ZEPTOMAIL_FROM_DOMAIN?.trim() || 'usebaci.com'}`,
        name: 'Baci Orders',
      },
      to: [{ email_address: { address: email.data } }],
      subject: title,
      htmlbody: `<p>${body}</p><p><a href="${url.href}">Resume checkout</a></p>`,
      textbody: `${body}\n${url.href}`,
      client_reference: `oxygen:${recipient.workflowId}:offers-ready`,
    },
    token
  );
  return true;
}
