import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { getCaptureHarness } from './primary-wallet-paid-interest-capture-replay.test-support';
import { applyPrimaryWalletSignedPaidInterest } from './primary-wallet-paid-interest-signed';

const harness = getCaptureHarness();
const secret = harness.secret;
let postWebhook: typeof import('@/app/api/webhooks/piggyvest/route').POST;
let drainInbox: typeof import('./primary-wallet-paid-interest-inbox-worker').drainPrimaryWalletPaidInterestInbox;
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  VERCEL_ENV: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED: 'true',
};

function capturedWireBytes(): Buffer {
  const event = {
    eventId: 'captured-interest-π-0001',
    eventType: 'interest-payout.success',
    eventCategory: 'interest-payout',
    customer_id: 'webhook-customer',
    eventData: {
      id: 'provider-payout',
      amount: 3000,
      destination_wallet: 'internal-destination',
      destination_wallet_balance: 13000,
      destination_wallet_ledger_balance: 13000,
      reference: 'paid-reference',
      timestamp: '2026-10-07T20:00:00.000Z',
      batch_id: 'batch-π',
      break_down: {
        gross_interest_payout: 3158,
        withholding_tax: 158,
        net_interest_payout: 3000,
      },
      futureEventData: {
        label: 'café ☕',
        nested: [1, { exact: 'keep  spaces' }],
      },
    },
    pvb_reference: 'paid-envelope-reference',
    pvb_wallet: 'source-interest-wallet',
    pvb_accrued_interest_wallet: 'accrued-interest-wallet',
    pvb_destination_wallet: null,
    pvb_third_party_reference: null,
    futureEnvelopeData: {
      providerVersion: 'vNext',
      opaque: '雪',
      untouched: { n: 7 },
    },
  };
  return Buffer.from(` \n${JSON.stringify(event, null, 2)} \t\n`, 'utf8');
}

function signed(bytes: Uint8Array): string {
  return createHmac('sha512', secret).update(bytes).digest('hex');
}

function request(bytes: Buffer, signature = signed(bytes)): NextRequest {
  return new NextRequest('https://baci.test/api/webhooks/piggyvest', {
    method: 'POST',
    headers: {
      'x-pvb-signature': signature,
      'content-type': 'application/json',
    },
    body: Uint8Array.from(bytes),
  });
}

describe('captured primary paid-interest webhook replay', () => {
  beforeAll(async () => {
    postWebhook = (await import('@/app/api/webhooks/piggyvest/route')).POST;
    drainInbox = (await import('./primary-wallet-paid-interest-inbox-worker'))
      .drainPrimaryWalletPaidInterestInbox;
  });

  beforeEach(() => {
    harness.logger.mockClear();
    harness.records.clear();
    harness.dispatch.mockReset();
    harness.finishFailure = false;
    harness.enqueueFailure = false;
    harness.claims = 0;
    harness.creditCount = 0;
    harness.notificationCount = 0;
    harness.handedOff = [];
    let providerReads = 0;
    const creditedEvents = new Set<string>();
    harness.dispatch.mockImplementation(
      async ({
        rawBody,
        signature,
      }: {
        rawBody: Uint8Array;
        signature: string | null;
      }) => {
        harness.handedOff.push({ bytes: Buffer.from(rawBody), signature });
        return await applyPrimaryWalletSignedPaidInterest({
          rawBody,
          signature,
          configuration: { ...fixture.config, webhookSecret: secret },
          involved: async () => true,
          resolveCrosswalk: async () => fixture.crosswalk,
          retrieveWallet: async (walletId) => {
            expect(walletId).toBe(fixture.crosswalk.apiWalletId);
            providerReads++;
            if (providerReads === 1)
              throw new Error('fake provider transport failure');
            return fixture.wallet;
          },
          apply: async (proof) => {
            if (creditedEvents.has(proof.eventId)) return 'duplicate';
            creditedEvents.add(proof.eventId);
            harness.creditCount++;
            harness.notificationCount++;
            return 'credited';
          },
        });
      }
    );
    vi.spyOn(console, 'warn').mockImplementation(harness.logger);
    vi.spyOn(console, 'error').mockImplementation(harness.logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('credits once through the fake atomic ledger, retries provider I/O, and replays after simulated lease expiry', async () => {
    const bytes = capturedWireBytes();
    const signature = signed(bytes);
    const first = await postWebhook(request(bytes, signature));
    expect(first.status).toBe(200);
    expect(await first.clone().text()).not.toContain(secret);
    expect(await first.clone().text()).not.toContain('provider-test-token');
    const receipt = harness.records.get('captured-interest-π-0001');
    expect(receipt).toMatchObject({
      rawHex: bytes.toString('hex'),
      signature,
      state: 'pending',
    });
    expect(receipt).toBeDefined();
    if (!receipt) throw new Error('Expected a durable captured receipt');
    expect(Buffer.from(receipt.rawHex, 'hex')).toEqual(bytes);

    await expect(drainInbox({ env })).rejects.toThrow('worker unavailable');
    expect(harness.records.get('captured-interest-π-0001')).toMatchObject({
      rawHex: bytes.toString('hex'),
      signature,
      state: 'pending',
    });

    harness.finishFailure = true;
    await expect(drainInbox({ env })).rejects.toThrow('worker unavailable');
    expect(harness.creditCount).toBe(1);
    expect(harness.notificationCount).toBe(1);
    expect(harness.records.get('captured-interest-π-0001')?.state).toBe(
      'pending'
    );

    expect((await drainInbox({ env })).processed).toBe(1);
    expect(harness.records.get('captured-interest-π-0001')?.state).toBe(
      'processed'
    );
    expect(harness.creditCount).toBe(1);
    expect(harness.notificationCount).toBe(1);
    expect(harness.dispatch).toHaveBeenCalledTimes(3);
    expect(harness.handedOff).toHaveLength(3);
    for (const handoff of harness.handedOff) {
      expect(handoff.bytes).toEqual(bytes);
      expect(handoff.signature).toBe(signature);
    }
    expect(harness.records.get('captured-interest-π-0001')?.rawHex).toBe(
      bytes.toString('hex')
    );
  });

  it('rejects forged signatures and returns 503 without exposing persistence failures', async () => {
    const bytes = capturedWireBytes();
    const invalid = await postWebhook(request(bytes, 'bad-signature'));
    expect(invalid.status).toBe(200);
    expect(harness.records.size).toBe(0);
    expect(harness.creditCount).toBe(0);

    harness.enqueueFailure = true;
    const failed = await postWebhook(request(bytes));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('private database detail');
    expect(harness.records.size).toBe(0);
    const capturedLogs = JSON.stringify(harness.logger.mock.calls);
    expect(capturedLogs).not.toContain(secret);
    expect(capturedLogs).not.toContain(bytes.toString('utf8'));
    expect(capturedLogs).not.toContain(signed(bytes));
  });

  it('durably captures a future event shape for quarantine without financial dispatch', async () => {
    const event = JSON.parse(capturedWireBytes().toString('utf8')) as Record<
      string,
      unknown
    >;
    event.eventData = { futureShape: 'provider-added field', opaque: 'é' };
    const bytes = Buffer.from(`\n${JSON.stringify(event)} \n`, 'utf8');
    const response = await postWebhook(request(bytes));
    expect(response.status).toBe(200);
    expect(harness.records.get(String(event.eventId))).toMatchObject({
      rawHex: bytes.toString('hex'),
      signature: signed(bytes),
    });
    expect((await drainInbox({ env })).quarantined).toBe(1);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.creditCount).toBe(0);
  });
});
