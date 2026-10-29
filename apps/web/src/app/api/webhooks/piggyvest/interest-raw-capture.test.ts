import { beforeEach, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture } from '@/lib/piggyvest/primary-wallet-bank-inbox.test-fixture';
import { deferredEvent } from '@/lib/piggyvest/webhook-processor.test-fixtures';
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

const bankBody = JSON.stringify(primaryBankInboxFixture.event);
const legacyBody = JSON.stringify(deferredEvent);
const custodyBody = JSON.stringify({
  eventId: 'synthetic-custody',
  eventType: 'wallet-transfer.outflow.success',
  eventCategory: 'wallet-transfer',
  customer_id: 'synthetic-customer',
  eventData: {},
});

it.each<[string, string, readonly PiggyvestWebhookKeyFamily[]]>([
  [
    'shared-family unknown shape',
    '{"unrecognized":{"nested":true}}',
    ['interest', 'legacy'],
  ],
  ['shared-family malformed bytes', '{ invalid', ['interest', 'legacy']],
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
  ['bank event with bank authority', bankBody, ['interest', 'bank']],
  ['bank event with legacy authority', bankBody, ['interest', 'legacy']],
  [
    'custody event with custody authority',
    custodyBody,
    ['interest', 'custody'],
  ],
  [
    'known legacy event with legacy authority',
    legacyBody,
    ['interest', 'legacy'],
  ],
  ['known bank event with interest authority only', bankBody, ['interest']],
  [
    'known custody event with interest authority only',
    custodyBody,
    ['interest'],
  ],
  ['known legacy event with interest authority only', legacyBody, ['interest']],
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

it('captures a malformed known event when the interest key is shared', async () => {
  mocks.inbox.mockResolvedValue('quarantined');
  const body =
    '{"eventType":"bank-transfer.inflow.success","private":"opaque"}';
  const response = await captureInterestRawDelivery(
    input(body, ['interest', 'bank'])
  );
  expect(response?.status).toBe(200);
  expect(mocks.inbox).toHaveBeenCalledWith({
    rawBody: Buffer.from(body),
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
])('returns redacted retryable failure for %s when durable capture is unavailable', async (_label, body) => {
  mocks.inbox.mockResolvedValue('disabled');
  const response = await captureInterestRawDelivery(input(body, ['interest']));

  expect(response?.status).toBe(503);
  const responseText = JSON.stringify(await response?.json());
  expect(responseText).not.toContain('synthetic-hmac');
  expect(responseText).not.toContain('interest-payout.success');
});

it('does not acknowledge an unknown payload under a shared key when raw capture is disabled', async () => {
  const body = '{"eventType":"future-interest-event","private":"payload"}';
  mocks.inbox.mockResolvedValue('disabled');
  const response = await captureInterestRawDelivery(
    input(body, ['interest', 'legacy'])
  );

  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({
    received: false,
    code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
  });
  expect(mocks.inbox).toHaveBeenCalledWith({
    rawBody: Buffer.from(body),
    signature: 'synthetic-hmac',
  });
});

it.each<[string, readonly PiggyvestWebhookKeyFamily[]]>([
  ['{"eventType":"unknown"}', ['legacy']],
  ['{ malformed', ['legacy']],
  ['{"eventType":"unknown"}', ['bank']],
  ['{ malformed', ['custody']],
  ['{"eventType":"bank-transfer.inflow.success"}', ['bank']],
  ['{"eventType":"create-wallet.success"}', ['legacy']],
])('does not acknowledge unknown authenticated bytes without replayable capture: %s (%s)', async (body, families) => {
  const response = await captureInterestRawDelivery(input(body, families));
  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({
    received: false,
    code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
  });
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
