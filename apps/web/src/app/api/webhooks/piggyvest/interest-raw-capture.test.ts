import { beforeEach, expect, it, vi } from 'vitest';
import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';

const mocks = vi.hoisted(() => ({ inbox: vi.fn() }));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-intake', () => ({
  dispatchPrimaryWalletPaidInterestInbox: mocks.inbox,
}));

import { captureInterestRawDelivery } from './interest-raw-capture';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inbox.mockResolvedValue('accepted');
});

function input(body: string, families: readonly PiggyvestWebhookKeyFamily[]) {
  return {
    rawBody: Buffer.from(body),
    signature: 'synthetic-hmac',
    families,
  } as const;
}

it.each<[string, string, readonly PiggyvestWebhookKeyFamily[]]>([
  [
    'shared-family unknown shape',
    '{"unrecognized":{"nested":true}}',
    ['interest', 'legacy'],
  ],
  ['shared-family malformed bytes', '{ invalid', ['interest', 'legacy']],
  [
    'dedicated-family known bank type',
    '{"eventType":"bank-transfer.inflow.success"}',
    ['interest'],
  ],
  [
    'dedicated-family known custody type',
    '{"eventType":"wallet-transfer.outflow.success"}',
    ['interest'],
  ],
  [
    'dedicated-family known legacy type',
    '{"eventType":"create-wallet.success"}',
    ['interest'],
  ],
])('durably captures %s for quarantine without financial dispatch', async (_label, body, families) => {
  mocks.inbox.mockResolvedValue('quarantined');
  const response = await captureInterestRawDelivery(input(body, families));

  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({ received: true, quarantined: true });
  expect(mocks.inbox).toHaveBeenCalledWith({
    rawBody: Buffer.from(body),
    signature: 'synthetic-hmac',
  });
});

it.each<[string, string, readonly PiggyvestWebhookKeyFamily[]]>([
  [
    'bank event with bank authority',
    '{"eventType":"bank-transfer.inflow.success"}',
    ['interest', 'bank'],
  ],
  [
    'bank event with legacy authority',
    '{"eventType":"bank-transfer.inflow.success"}',
    ['interest', 'legacy'],
  ],
  [
    'custody event with custody authority',
    '{"eventType":"wallet-transfer.outflow.success"}',
    ['interest', 'custody'],
  ],
  [
    'known legacy event with legacy authority',
    '{"eventType":"create-wallet.success"}',
    ['interest', 'legacy'],
  ],
])('leaves %s on its existing family route', async (_label, body, families) => {
  expect(await captureInterestRawDelivery(input(body, families))).toBeNull();
  expect(mocks.inbox).not.toHaveBeenCalled();
});

it('captures explicit interest payouts before validating their envelope', async () => {
  const rawBody = Buffer.from(
    ' {"eventType":"interest-payout.success","eventData":{"currency":"USD","extra":{"x":1}}} \n'
  );

  const response = await captureInterestRawDelivery({
    rawBody,
    signature: 'synthetic-hmac',
    families: ['interest', 'legacy'],
  });

  expect(response?.status).toBe(200);
  expect(mocks.inbox).toHaveBeenCalledWith({
    rawBody,
    signature: 'synthetic-hmac',
  });
});

it.each([
  ['explicit interest', '{"eventType":"interest-payout.success"}'],
  [
    'unrecognized interest-family envelope',
    '{"eventType":"future-interest-event"}',
  ],
  ['malformed interest-family bytes', '{ malformed'],
  [
    'other envelope signed only by the interest key',
    '{"eventType":"bank-transfer.inflow.success"}',
  ],
])('returns redacted retryable failure for %s when durable capture is unavailable', async (_label, body) => {
  mocks.inbox.mockResolvedValue('disabled');
  const response = await captureInterestRawDelivery(input(body, ['interest']));

  expect(response?.status).toBe(503);
  const responseText = JSON.stringify(await response?.json());
  expect(responseText).not.toContain('synthetic-hmac');
  expect(responseText).not.toContain('interest-payout.success');
});

it('does not capture any bytes without verified interest-family authority', async () => {
  expect(
    await captureInterestRawDelivery(
      input('{"eventType":"unknown"}', ['legacy'])
    )
  ).toBeNull();
  expect(mocks.inbox).not.toHaveBeenCalled();
});

it('fails closed on explicit interest without interest-family authority', async () => {
  const response = await captureInterestRawDelivery(
    input('{"eventType":"interest-payout.success"}', ['legacy'])
  );

  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({
    code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
  });
  expect(mocks.inbox).not.toHaveBeenCalled();
});

it('emits only a redacted warning when an authenticated interest delivery cannot be saved', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const body =
      '{"eventType":"interest-payout.success","secret":"private-body"}';
    const response = await captureInterestRawDelivery(input(body, ['legacy']));
    expect(response?.status).toBe(503);
    expect(warning).toHaveBeenCalledWith(
      '[PiggyVest Webhook] PIGGYVEST_INTEREST_RECONCILIATION_PENDING'
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-body');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic-hmac');
  } finally {
    warning.mockRestore();
  }
});

it('warns without logging an intake error before letting the route return 503', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.inbox.mockRejectedValue(new Error('sensitive database detail'));
  try {
    await expect(
      captureInterestRawDelivery(
        input('{"eventType":"interest-payout.success"}', ['interest'])
      )
    ).rejects.toThrow('sensitive database detail');
    expect(warning).toHaveBeenCalledWith(
      '[PiggyVest Webhook] PIGGYVEST_INTEREST_RECONCILIATION_PENDING'
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      'sensitive database detail'
    );
  } finally {
    warning.mockRestore();
  }
});
