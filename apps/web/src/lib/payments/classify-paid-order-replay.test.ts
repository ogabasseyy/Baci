import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrderOutboxState: vi.fn(),
}));

vi.mock('./order-has-outbox-rows', () => ({
  getOrderOutboxState: mocks.getOrderOutboxState,
}));

import { classifyPaidOrderReplay } from './classify-paid-order-replay';

const base = {
  alreadyCompleted: false,
  orderAlreadyPaid: true,
  orderId: 'order-1',
  orderUpdated: false,
  redvaultDuplicate: false,
  supabase: {} as never,
  transactionId: 'txn-1',
  wonTransactionFlip: true,
};

function outboxState(overrides = {}) {
  return {
    hasRows: true,
    lookupFailed: false,
    onlyFreshPrePushEvidence: false,
    onlyUntouchedSeed: false,
    payerTransactionId: 'txn-other',
    ...overrides,
  };
}

describe('classifyPaidOrderReplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrderOutboxState.mockResolvedValue(outboxState());
  });

  it('classifies a fresh settlement without touching the outbox', async () => {
    const result = await classifyPaidOrderReplay({
      ...base,
      orderAlreadyPaid: false,
      orderUpdated: true,
    });

    expect(result.outboxState).toBeNull();
    expect(result.capturedOnAlreadyPaidOrder).toBe(false);
    expect(result.legacyPaidReplay).toBe(false);
    expect(result.shouldNotify).toBe(true);
    expect(mocks.getOrderOutboxState).not.toHaveBeenCalled();
  });

  it('marks an already-completed capture that flipped the order as healed', async () => {
    const result = await classifyPaidOrderReplay({
      ...base,
      alreadyCompleted: true,
      orderUpdated: true,
    });

    expect(result.healed).toBe(true);
    expect(result.shouldNotify).toBe(true);
  });

  it('flags a capture on an already-paid order and suppresses notify', async () => {
    const result = await classifyPaidOrderReplay(base);

    expect(result.capturedOnAlreadyPaidOrder).toBe(true);
    expect(result.legacyPaidReplay).toBe(false);
    expect(result.shouldNotify).toBe(false);
  });

  it('treats a same-transaction replay as the payer, not a new capture', async () => {
    mocks.getOrderOutboxState.mockResolvedValue(
      outboxState({ payerTransactionId: 'txn-1' })
    );

    const result = await classifyPaidOrderReplay(base);

    expect(result.capturedOnAlreadyPaidOrder).toBe(false);
  });

  it('classifies a legacy paid replay when no outbox rows exist', async () => {
    mocks.getOrderOutboxState.mockResolvedValue(
      outboxState({ hasRows: false, payerTransactionId: null })
    );

    const result = await classifyPaidOrderReplay({
      ...base,
      wonTransactionFlip: false,
    });

    expect(result.legacyPaidReplay).toBe(true);
    expect(result.capturedOnAlreadyPaidOrder).toBe(false);
  });

  it('owes notify when only an aged untouched seed remains', async () => {
    mocks.getOrderOutboxState.mockResolvedValue(
      outboxState({
        onlyUntouchedSeed: true,
        payerTransactionId: 'txn-1',
      })
    );

    const result = await classifyPaidOrderReplay({
      ...base,
      redvaultDuplicate: true,
      wonTransactionFlip: false,
    });

    expect(result.capturedOnAlreadyPaidOrder).toBe(false);
    expect(result.shouldNotify).toBe(true);
  });

  it('surfaces an outbox lookup failure on an already-paid order', async () => {
    mocks.getOrderOutboxState.mockResolvedValue(
      outboxState({ lookupFailed: true, payerTransactionId: null })
    );

    const result = await classifyPaidOrderReplay(base);

    expect(result.sideEffectsLookupFailed).toBe(true);
  });
});
