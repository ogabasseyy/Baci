import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/app/api/webhooks/piggyvest/primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: mocks.dispatch,
  isKillSwitchDeferral: () => false,
}));

import type { ReplayDelivery } from './webhook-capture-drain';
import { replayPrimaryDelivery } from './webhook-capture-primary-replay';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

const inflow = JSON.stringify({
  eventId: 'evt-replay-1',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'fixture-customer',
  pvb_reference: 'fixture-pvb-reference',
  pvb_wallet: 'fixture-wallet',
  eventData: {
    id: 'fixture-data',
    customer_id: 'fixture-customer',
    destination_wallet_id: 'fixture-conduit',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: '',
    ip_address: '',
    transaction_id: 'fixture-transaction',
    timestamp: '2026-10-07T10:00:00.000Z',
    status: 'COMPLETED',
    third_party_reference: '',
    initiator_reference: '',
    internal_reference: '',
    provider: 'fixture-bank',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'fixture-reference',
    recipient_bank_account_number: '0123456789',
    sender_name: 'Fixture sender',
    fee: 0,
  },
});
const accrued = JSON.stringify({
  eventId: 'evt-accrued-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});

function delivery(
  body: string,
  families: PiggyvestWebhookKeyFamily[],
  incompleteKeySet = false
): ReplayDelivery {
  return {
    rawBody: Buffer.from(body),
    signature: 'ab'.repeat(64),
    matchedSecret: 'matched-secret',
    families,
    recordedFamilies: families,
    incompleteKeySet,
    keyScope: 'replay',
  };
}

const json = (status: number) =>
  new Response(JSON.stringify({ received: status < 300 }), { status });

beforeEach(() => {
  mocks.dispatch.mockReset();
});

describe('replayPrimaryDelivery', () => {
  it('hands the stored bytes to the primary intakes under the replay key scope', async () => {
    mocks.dispatch.mockResolvedValue(json(200));

    await expect(
      replayPrimaryDelivery(delivery(inflow, ['bank']))
    ).resolves.toEqual({ status: 200 });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      rawBody: Buffer.from(inflow),
      signature: 'ab'.repeat(64),
      matchedSecret: 'matched-secret',
      event: expect.objectContaining({
        eventId: 'evt-replay-1',
        eventType: 'bank-transfer.inflow.success',
      }),
      families: ['bank'],
      keyScope: 'replay',
      env: expect.any(Object),
    });
  });

  it('reports a retryable intake answer as incomplete', async () => {
    mocks.dispatch.mockResolvedValue(json(503));
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['bank']))
    ).resolves.toEqual({ status: 503 });
  });

  it('marks a redelivery conflict for review instead of completing it', async () => {
    mocks.dispatch.mockResolvedValue('conflict');
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['bank']))
    ).resolves.toEqual({ status: 200, conflict: true });
  });

  it.each([
    ['unparseable bytes', '{not json'],
    ['an unknown event shape', JSON.stringify({ eventType: 'x' })],
  ])('flags %s as a content quarantine without dispatching', async (_label, body) => {
    await expect(
      replayPrimaryDelivery(delivery(body, ['bank']))
    ).resolves.toEqual({ status: 200, contentQuarantine: true });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('finishes a mixed-family primary success while the enabled legacy fallback is unconfigured', async () => {
    mocks.dispatch.mockResolvedValue(json(200));
    await expect(
      replayPrimaryDelivery(
        {
          ...delivery(inflow, ['bank', 'legacy']),
          recordedFamilies: ['bank', 'legacy'],
        },
        {
          NODE_ENV: 'test',
          PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
        }
      )
    ).resolves.toEqual({ status: 200 });
  });

  it('defers a broken enabled direct inflow for legacy-only bank signatures', async () => {
    mocks.dispatch.mockResolvedValue(null);
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['legacy']), {
        NODE_ENV: 'test',
        PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED: 'true',
        PIGGYVEST_PRIMARY_ENABLED: 'true',
        PIGGYVEST_PRIMARY_INFLOWS_ENABLED: 'true',
      })
    ).resolves.toEqual({ status: 503, primaryInflowUnavailable: true });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('flags a delivery no primary intake owns and no legacy path may take as an authorization quarantine', async () => {
    mocks.dispatch.mockResolvedValue(null);
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['interest']))
    ).resolves.toEqual({ status: 200, authorizationQuarantine: true });
  });

  it('asks for the complete key set instead of quarantining while it is incomplete', async () => {
    mocks.dispatch.mockResolvedValue(null);
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['interest'], true))
    ).resolves.toEqual({ status: 503, keySetIncomplete: true });
  });

  it('never completes an owned event whose owning family was not loaded', async () => {
    mocks.dispatch.mockResolvedValue(json(200));
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['interest'], true))
    ).resolves.toEqual({ status: 503, keySetIncomplete: true });
  });

  it.each<[string, string, PiggyvestWebhookKeyFamily[]]>([
    ['a record-only accrual', accrued, ['interest']],
    [
      'a legacy-authorized inflow no primary intake claimed',
      inflow,
      ['bank', 'legacy'],
    ],
  ])('defers %s: only the legacy path, which needs the service role, could finish it', async (_label, body, families) => {
    mocks.dispatch.mockResolvedValue(null);
    await expect(
      replayPrimaryDelivery(delivery(body, families))
    ).resolves.toEqual({ status: 503, outOfScope: 'LEGACY_PATH' });
  });

  it('sets aside a legacy-authorized delivery the host verified only under the owner family, instead of quarantining it', async () => {
    // Admission recorded bank and legacy (one secret configured for both on
    // the web app); the worker host holds that secret only as the bank key,
    // so verification narrows to bank. Setting it aside grants nothing.
    mocks.dispatch.mockResolvedValue(null);
    await expect(
      replayPrimaryDelivery({
        ...delivery(inflow, ['bank']),
        recordedFamilies: ['bank', 'legacy'],
      })
    ).resolves.toEqual({ status: 503, outOfScope: 'LEGACY_PATH' });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ families: ['bank'] })
    );
  });

  it('still quarantines when admission recorded no family the legacy path accepts', async () => {
    mocks.dispatch.mockResolvedValue(null);
    await expect(
      replayPrimaryDelivery({
        ...delivery(inflow, ['interest']),
        recordedFamilies: ['interest'],
      })
    ).resolves.toEqual({ status: 200, authorizationQuarantine: true });
  });

  it('turns an intake failure into a plain retry without its detail', async () => {
    mocks.dispatch.mockRejectedValue(new Error('private storage detail'));
    await expect(
      replayPrimaryDelivery(delivery(inflow, ['bank']))
    ).resolves.toEqual({ status: 503 });
  });
});
