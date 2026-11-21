import { afterEach, expect, it, vi } from 'vitest';

const { push, mail } = vi.hoisted(() => ({ push: vi.fn(), mail: vi.fn() }));
vi.mock('@/lib/expo-push-chunk-delivery', () => ({
  sendPushNotificationChunks: push,
}));
vi.mock('@/lib/expo-push-lazy-client', () => ({
  createLazyExpoGetter: () => () => ({}),
}));
type ZeptoMailTransport = typeof import('@/lib/zeptomail-transport');
vi.mock('@/lib/zeptomail-transport', async (load) => ({
  ...(await load<ZeptoMailTransport>()),
  zeptoMailRequest: mail,
}));

import { sendOxygenOffersReady } from './offers-ready-notification';

const recipient = {
  workflowId: '60000000-0000-4000-8000-000000000011',
  orderId: '60000000-0000-4000-8000-000000000012',
  merchantSlug: 'ogabassey',
  email: 'customer@example.test',
  pushToken: 'mock-token',
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it('routes mobile users to the saved order without sending a second email', async () => {
  push.mockResolvedValue({
    tickets: [{ status: 'ok' }],
    deliveryUncertain: false,
  });
  expect(await sendOxygenOffersReady(recipient)).toBe(true);
  expect(push).toHaveBeenCalledWith(expect.anything(), [
    expect.objectContaining({
      to: recipient.pushToken,
      data: { type: 'order_update', orderId: recipient.orderId },
    }),
  ]);
  expect(mail).not.toHaveBeenCalled();
});
it('emails an authenticated checkout link when push is unavailable', async () => {
  vi.stubEnv('ZEPTOMAIL_TOKEN', 'mock-token');
  expect(await sendOxygenOffersReady({ ...recipient, pushToken: null })).toBe(
    true
  );
  expect(mail).toHaveBeenCalledWith(
    'email',
    expect.objectContaining({
      subject: 'Your payment options are ready',
      htmlbody: expect.stringContaining(
        `https://usebaci.com/ogabassey/checkout?oxygenOrderId=${recipient.orderId}`
      ),
    }),
    'mock-token'
  );
});
it('does not send a duplicate fallback when the push outcome is uncertain', async () => {
  push.mockResolvedValue({ tickets: [], deliveryUncertain: true });
  vi.stubEnv('ZEPTOMAIL_TOKEN', 'mock-token');
  expect(await sendOxygenOffersReady(recipient)).toBe(false);
  expect(mail).not.toHaveBeenCalled();
});

it.each([
  ['ZEPTOMAIL_REQUEST_NOT_SENT', 75_000, true],
  ['ZEPTOMAIL_REQUEST_NOT_SENT', 30_000, false],
  ['ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN', 75_000, false],
])('handles email failure %s with %i ms remaining', async (code, remaining, retry) => {
  vi.stubEnv('ZEPTOMAIL_TOKEN', 'mock-token');
  const failure = Object.assign(new Error('Connection failed'), { code });
  mail.mockRejectedValueOnce(failure);
  const delivery = sendOxygenOffersReady(
    { ...recipient, pushToken: null },
    Date.now() + remaining
  );
  if (retry) {
    await expect(delivery).resolves.toBe(true);
  } else {
    await expect(delivery).rejects.toBe(failure);
  }
  expect(mail).toHaveBeenCalledTimes(retry ? 2 : 1);
});
