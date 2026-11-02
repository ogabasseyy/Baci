import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';

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

const supabase = {} as PiggyvestIntakeServiceClient;

const claimToken = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

describe('processPiggyvestEvent interest-accrued', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockClaim.mockResolvedValue({ outcome: 'claimed', claimToken });
    mockResolve.mockResolvedValue(undefined);
    mockRecordPayout.mockResolvedValue('credited');
    mockRecordInflow.mockResolvedValue('credited');
    mockApplyCreated.mockResolvedValue('restricted');
    mockApplyLifted.mockResolvedValue('ready');
    mockApplyOutflow.mockResolvedValue('matched');
    mockRecordQuarantine.mockResolvedValue('recorded');
    mockSavingsOutflow.mockResolvedValue('unmatched');
  });

  it('acknowledges and records interest-accrued events without any ledger write', async () => {
    const accrued = {
      eventId: '01K8TESTACCRUED001',
      eventType: 'interest-accrued.success',
      eventCategory: 'interest_accrued',
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      eventData: { id: 'synthetic-accrual-001', amount: 12.5 },
    } as const;

    await expect(processPiggyvestEvent(supabase, accrued)).resolves.toBe(
      'processed'
    );

    expect(mockResolve).toHaveBeenCalledWith(supabase, {
      eventId: accrued.eventId,
      claimToken,
      status: 'processed',
    });
    expect(mockRecordPayout).not.toHaveBeenCalled();
    expect(mockRecordInflow).not.toHaveBeenCalled();
    expect(mockApplyCreated).not.toHaveBeenCalled();
    expect(mockApplyLifted).not.toHaveBeenCalled();
    expect(mockApplyOutflow).not.toHaveBeenCalled();
    expect(mockSavingsOutflow).not.toHaveBeenCalled();
  });
});
