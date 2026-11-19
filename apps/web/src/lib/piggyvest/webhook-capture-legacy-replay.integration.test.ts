import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  record: vi.fn(),
  claim: vi.fn(),
  resolve: vi.fn(),
  inflow: vi.fn(),
  payout: vi.fn(),
  dispose: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/app/api/webhooks/piggyvest/primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: mocks.dispatch,
  isKillSwitchDeferral: () => false,
}));
vi.mock('@/app/api/webhooks/piggyvest/quarantine-and-ack', () => ({
  quarantineAndAck: vi.fn(async () => Response.json({ received: true })),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: mocks.record,
  claimPiggyvestEvent: mocks.claim,
  resolvePiggyvestEvent: mocks.resolve,
}));
vi.mock('@/lib/piggyvest/inflow-ledger', () => ({
  InflowLedgerError: class InflowLedgerError extends Error {},
  recordInflowCredit: mocks.inflow,
}));
vi.mock('@/lib/piggyvest/interest-ledger', () => ({
  InterestLedgerError: class InterestLedgerError extends Error {},
  recordInterestPayout: mocks.payout,
}));
vi.mock('@/lib/piggyvest/plan-wallet-restrictions', () => ({
  PlanWalletRestrictionError: class PlanWalletRestrictionError extends Error {},
  applyRestrictionCreated: vi.fn(),
  applyRestrictionLifted: vi.fn(),
  attributedWalletId: vi.fn(),
}));
vi.mock('@/lib/piggyvest/unmapped-alert-once', () => ({
  alertUnmappedInflow: vi.fn(),
}));

import interestPayout from '@/schemas/piggyvest/interest-payout-success.fixture.json';
import type { ReplayDelivery } from './webhook-capture-drain';
import { schemaValidInflow } from './webhook-capture-drain.test-support';
import { replayLegacyDelivery } from './webhook-capture-legacy-replay';

const claimToken = '30000000-0000-4000-8000-000000000099';
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_SECRET_KEY: 'synthetic-legacy-token',
  PIGGYVEST_API_BASE_URL: 'https://sandbox.example.invalid',
};

function stored(body: unknown): ReplayDelivery {
  const rawBody = Buffer.isBuffer(body)
    ? Buffer.from(body)
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    rawBody,
    signature: 'exact-captured-signature',
    matchedSecret: 'synthetic-legacy-key',
    families: ['legacy'],
    recordedFamilies: ['legacy'],
    keyScope: 'replay',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue(null);
  mocks.record.mockResolvedValue('new');
  mocks.claim.mockResolvedValue({ outcome: 'claimed', claimToken });
  mocks.resolve.mockResolvedValue(undefined);
  mocks.inflow.mockResolvedValue('credited');
  mocks.payout.mockResolvedValue(undefined);
});

describe('legacy replay through the real verified-delivery pipeline', () => {
  it('retries the exact stored bank payload after a transient ledger failure, then resolves it', async () => {
    const delivery = stored(schemaValidInflow('retry-same-event'));
    mocks.inflow
      .mockRejectedValueOnce(new Error('synthetic ledger outage'))
      .mockResolvedValueOnce('credited');
    const createClient = vi.fn(() => ({ dispose: mocks.dispose }) as never);

    const first = await replayLegacyDelivery(delivery, env, { createClient });
    const recovered = await replayLegacyDelivery(delivery, env, {
      createClient,
    });

    expect(first).toEqual({ status: 503 });
    expect(recovered).toEqual({ status: 200 });
    expect(mocks.inflow).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.resolve.mock.calls.map(([, input]) => input.status)).toEqual([
      'failed',
      'processed',
    ]);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('records accrual notices without invoking a money ledger', async () => {
    const accrual = {
      eventId: '30000000-0000-4000-8000-000000000001',
      customer_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      eventType: 'interest-accrued.success',
      eventCategory: 'interest_accrued',
      eventData: {
        id: '30000000-0000-4000-8000-000000000002',
        wallet_id: '30000000-0000-4000-8000-000000000003',
        balance: 1650000,
        percentage: 9,
        interest_date: '2026-09-28T00:00:00.000Z',
        amount: 406.8493150684931,
        interest_type: 'original',
      },
      pvb_wallet: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    };
    await expect(
      replayLegacyDelivery(stored(accrual), env, {
        createClient: () => ({ dispose: mocks.dispose }) as never,
      })
    ).resolves.toEqual({ status: 200 });
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.inflow).not.toHaveBeenCalled();
    expect(mocks.payout).not.toHaveBeenCalled();
  });

  it('recovers the same monthly accrual after the first durable inbox write fails', async () => {
    const accrual = {
      eventId: '30000000-0000-4000-8000-000000000011',
      customer_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      eventType: 'interest-accrued.success',
      eventCategory: 'interest_accrued',
      eventData: {
        id: '30000000-0000-4000-8000-000000000012',
        wallet_id: '30000000-0000-4000-8000-000000000013',
        balance: 1650000,
        percentage: 9,
        interest_date: '2026-10-31T00:00:00.000Z',
        amount: 406.8493150684931,
        interest_type: 'monthly',
        provider_extra_monthly_field: 'retain in exact capture bytes',
      },
      pvb_wallet: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    };
    const originalBytes = Buffer.from(JSON.stringify(accrual));
    const delivery = stored(originalBytes);
    mocks.record.mockRejectedValueOnce(new Error('synthetic inbox outage'));
    const createClient = vi.fn(() => ({ dispose: mocks.dispose }) as never);

    const first = await replayLegacyDelivery(delivery, env, { createClient });
    const recovered = await replayLegacyDelivery(delivery, env, {
      createClient,
    });

    expect(first).toEqual({ status: 503 });
    expect(recovered).toEqual({ status: 200 });
    expect(delivery.rawBody).toEqual(originalBytes);
    expect(delivery.rawBody.toString()).toContain(
      'provider_extra_monthly_field'
    );
    expect(delivery.rawBody.toString()).toContain(
      'retain in exact capture bytes'
    );
    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.inflow).not.toHaveBeenCalled();
    expect(mocks.payout).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing interest payout handler on the restricted intake client', async () => {
    await expect(
      replayLegacyDelivery(stored(interestPayout), env, {
        createClient: () => ({ dispose: mocks.dispose }) as never,
      })
    ).resolves.toEqual({ status: 200 });
    expect(mocks.payout).toHaveBeenCalledWith(
      expect.objectContaining({ dispose: expect.any(Function) }),
      expect.objectContaining({ eventType: 'interest-payout.success' })
    );
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
