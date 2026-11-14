import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiggyvestIntakeClient } from '@/lib/piggyvest/intake-client.types';
import { resetUnmappedAlertMemoryForTests } from './unmapped-alert-once';
import { inflowEvent } from './webhook-processor.test-fixtures';

const mockClaim = vi.fn();
const mockResolve = vi.fn();
const mockRecordPayout = vi.fn();
const mockRecordInflow = vi.fn();
const mockApplyCreated = vi.fn();
const mockApplyLifted = vi.fn();
const mockApplyOutflow = vi.fn();
const mockRecordQuarantine = vi.fn();
const mockSavingsOutflow = vi.fn();

vi.mock('./event-quarantine', () => ({
  recordQuarantineEvent: (...args: unknown[]) => mockRecordQuarantine(...args),
}));

vi.mock('./webhook-inbox', () => ({
  claimPiggyvestEvent: (...args: unknown[]) => mockClaim(...args),
  resolvePiggyvestEvent: (...args: unknown[]) => mockResolve(...args),
}));

const mockLog = vi.fn();
const mockSend = vi.fn();
vi.mock('./webhook-alerts', () => ({
  emitPiggyvestWebhookAlert: vi.fn(),
  logPiggyvestWebhookAlert: (...args: unknown[]) => mockLog(...args),
  sendPiggyvestWebhookAlertDelivered: (...args: unknown[]) => mockSend(...args),
}));

vi.mock('./inflow-ledger', () => ({
  InflowLedgerError: class InflowLedgerError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'InflowLedgerError';
      this.code = code;
    }
  },
  recordInflowCredit: (...args: unknown[]) => mockRecordInflow(...args),
}));

vi.mock('./interest-ledger', () => ({
  InterestLedgerError: class InterestLedgerError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'InterestLedgerError';
      this.code = code;
    }
  },
  recordInterestPayout: (...args: unknown[]) => mockRecordPayout(...args),
}));

import { InflowLedgerError } from './inflow-ledger';
import { processPiggyvestEvent } from './webhook-processor';

vi.mock('./primary-wallet-savings-outflow-reconciliation', () => ({
  runPrimaryWalletSavingsOutflowReconciliation: (...args: unknown[]) =>
    mockSavingsOutflow(...args),
}));

vi.mock('./transfer-outbox', () => ({
  applyOutflowTerminal: (...args: unknown[]) => mockApplyOutflow(...args),
  outflowReferenceCandidates: (eventData: Record<string, unknown>) =>
    typeof eventData.reference === 'string' && eventData.reference
      ? [eventData.reference]
      : [],
}));

vi.mock('./plan-wallet-restrictions', () => ({
  applyRestrictionCreated: (...args: unknown[]) => mockApplyCreated(...args),
  applyRestrictionLifted: (...args: unknown[]) => mockApplyLifted(...args),
  attributedWalletId: (event: { pvb_wallet?: string }) =>
    event.pvb_wallet ?? null,
  PlanWalletRestrictionError: class PlanWalletRestrictionError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'PlanWalletRestrictionError';
      this.code = code;
    }
  },
}));

const supabase = {} as PiggyvestIntakeClient;

const claimToken = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

describe('processPiggyvestEvent unmapped inflow alert', () => {
  const unmappedError = () =>
    new InflowLedgerError('INFLOW_LEDGER_UNMAPPED', 'no mapping');

  beforeEach(() => {
    vi.resetAllMocks();
    resetUnmappedAlertMemoryForTests();
    mockClaim.mockResolvedValue({ outcome: 'claimed', claimToken });
    mockResolve.mockResolvedValue(undefined);
    mockSend.mockResolvedValue(true);
  });

  it('alerts and stays retryable when a deposit arrives for an unmapped wallet', async () => {
    const unmapped = unmappedError();
    mockRecordInflow.mockRejectedValue(unmapped);
    await expect(
      processPiggyvestEvent(supabase, inflowEvent as never)
    ).rejects.toBe(unmapped);
    expect(mockLog).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_INFLOW_UNMAPPED',
      {
        eventType: inflowEvent.eventType,
        operationId: inflowEvent.eventData.transaction_id,
      }
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ claimToken, status: 'failed' })
    );
  });

  it('writes the unmapped log line only once when the same deposit is redelivered', async () => {
    const unmapped = unmappedError();
    mockRecordInflow.mockRejectedValue(unmapped);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        processPiggyvestEvent(supabase, inflowEvent as never)
      ).rejects.toBe(unmapped);
    }
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledTimes(3);
  });

  it('adds no second log line when PostHog fails and the deposit is redelivered', async () => {
    const unmapped = unmappedError();
    mockRecordInflow.mockRejectedValue(unmapped);
    mockSend.mockRejectedValueOnce(new Error('posthog down'));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        processPiggyvestEvent(supabase, inflowEvent as never)
      ).rejects.toBe(unmapped);
    }
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('writes the unmapped log line once per deposit even under a new event id', async () => {
    const unmapped = unmappedError();
    mockRecordInflow.mockRejectedValue(unmapped);
    await expect(
      processPiggyvestEvent(supabase, inflowEvent as never)
    ).rejects.toBe(unmapped);
    await expect(
      processPiggyvestEvent(supabase, {
        ...inflowEvent,
        eventId: '01K8TESTINFLOW002',
      } as never)
    ).rejects.toBe(unmapped);
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it('does not raise the unmapped alert for other inflow failures', async () => {
    mockRecordInflow.mockRejectedValue(new Error('storage unavailable'));
    await expect(
      processPiggyvestEvent(supabase, inflowEvent as never)
    ).rejects.toThrow('storage unavailable');
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('still retries the unmapped deposit when the alert itself throws', async () => {
    const unmapped = unmappedError();
    mockRecordInflow.mockRejectedValue(unmapped);
    mockLog.mockImplementation(() => {
      throw new Error('alert down');
    });
    await expect(
      processPiggyvestEvent(supabase, inflowEvent as never)
    ).rejects.toBe(unmapped);
    expect(mockResolve).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ claimToken, status: 'failed' })
    );
  });
});
