import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deferredEvent,
  inflowEvent,
  interestEvent,
  restrictionCreatedEvent,
  restrictionLiftedEvent,
} from './webhook-processor.test-fixtures';

const mockClaim = vi.fn();
const mockResolve = vi.fn();
const mockRecordPayout = vi.fn();
const mockRecordInflow = vi.fn();
const mockApplyCreated = vi.fn();
const mockApplyLifted = vi.fn();
const mockApplyOutflow = vi.fn();

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

import { InflowLedgerError } from './inflow-ledger';
import { InterestLedgerError } from './interest-ledger';
import { processPiggyvestEvent } from './webhook-processor';

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

const supabase = {} as SupabaseClient;

const claimToken = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

describe('processPiggyvestEvent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockClaim.mockResolvedValue({ outcome: 'claimed', claimToken });
    mockResolve.mockResolvedValue(undefined);
    mockRecordPayout.mockResolvedValue('credited');
    mockRecordInflow.mockResolvedValue('credited');
    mockApplyCreated.mockResolvedValue('restricted');
    mockApplyLifted.mockResolvedValue('ready');
    mockApplyOutflow.mockResolvedValue('matched');
  });

  it('defers unhandled events without claiming', async () => {
    await expect(processPiggyvestEvent(supabase, deferredEvent)).resolves.toBe(
      'deferred'
    );
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it.each([
    [interestEvent, mockRecordPayout],
    [inflowEvent, mockRecordInflow],
    [restrictionCreatedEvent, mockApplyCreated],
  ])('applies claimed events and fences completion: %j', async (event, effect) => {
    await expect(processPiggyvestEvent(supabase, event as never)).resolves.toBe(
      'processed'
    );
    expect(effect).toHaveBeenCalledOnce();
    expect(mockResolve).toHaveBeenCalledWith(supabase, {
      eventId: event.eventId,
      claimToken,
      status: 'processed',
    });
  });

  it('passes provider config through on restriction lift', async () => {
    const config = { token: 'synthetic' };
    await processPiggyvestEvent(supabase, restrictionLiftedEvent, {
      piggyvestConfig: config,
    });
    expect(mockApplyLifted).toHaveBeenCalledWith(
      supabase,
      config,
      'pvb-wallet-synthetic-001'
    );
  });

  it('acks unattributed restrictions only after failed persistence', async () => {
    const { pvb_wallet: _wallet, ...event } = restrictionCreatedEvent;
    await expect(processPiggyvestEvent(supabase, event)).resolves.toBe(
      'processed'
    );
    expect(mockApplyCreated).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith(supabase, {
      eventId: event.eventId,
      claimToken,
      status: 'failed',
      lastError: 'restriction unattributed',
    });
  });

  it.each([
    ['bank-transfer.outflow.success', 'succeeded'],
    ['bank-transfer.outflow.failed', 'failed'],
    ['wallet-transfer.outflow.success', 'succeeded'],
  ])('applies %s by reference', async (eventType, status) => {
    const event = {
      eventId: 'outflow-001',
      eventType,
      eventData: { reference: 'ref-001' },
    };
    await expect(processPiggyvestEvent(supabase, event as never)).resolves.toBe(
      'processed'
    );
    expect(mockApplyOutflow).toHaveBeenCalledWith(supabase, {
      references: ['ref-001'],
      status,
    });
    expect(mockResolve).toHaveBeenCalledWith(supabase, {
      eventId: event.eventId,
      claimToken,
      status: 'processed',
    });
  });

  it('resolves unattributed outflow without effect', async () => {
    const event = {
      eventId: 'outflow-002',
      eventType: 'wallet-transfer.outflow.success',
      eventData: {},
    };
    await expect(processPiggyvestEvent(supabase, event as never)).resolves.toBe(
      'processed'
    );
    expect(mockApplyOutflow).not.toHaveBeenCalled();
  });

  it('acks without work only when already processed', async () => {
    mockClaim.mockResolvedValue({ outcome: 'processed' });
    await expect(processPiggyvestEvent(supabase, interestEvent)).resolves.toBe(
      'processed'
    );
    expect(mockRecordPayout).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it.each([
    'busy',
    'unknown',
  ])('throws for %s so crashed work is not acknowledged', async (outcome) => {
    mockClaim.mockResolvedValue({ outcome });
    await expect(
      processPiggyvestEvent(supabase, interestEvent)
    ).rejects.toThrow();
    expect(mockRecordPayout).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it.each([
    [
      interestEvent,
      mockRecordPayout,
      new InterestLedgerError('INTEREST_LEDGER_INCONSISTENT', 'poison'),
    ],
    [
      inflowEvent,
      mockRecordInflow,
      new InflowLedgerError('INFLOW_LEDGER_INVALID', 'poison'),
    ],
  ])('acks poison only after fenced failed persistence: %j', async (event, effect, error) => {
    effect.mockRejectedValue(error);
    await expect(processPiggyvestEvent(supabase, event as never)).resolves.toBe(
      'processed'
    );
    expect(mockResolve).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ claimToken, status: 'failed' })
    );
  });

  it('does not acknowledge poison when failed persistence fails', async () => {
    mockRecordPayout.mockRejectedValue(
      new InterestLedgerError('INTEREST_LEDGER_INCONSISTENT', 'poison')
    );
    mockResolve.mockRejectedValue(new Error('persistence unavailable'));
    await expect(
      processPiggyvestEvent(supabase, interestEvent)
    ).rejects.toThrow('persistence unavailable');
  });

  it('rethrows storage failures even when releasing the lease fails', async () => {
    mockRecordPayout.mockRejectedValue(new Error('storage unavailable'));
    mockResolve.mockRejectedValue(new Error('lease lost'));
    await expect(
      processPiggyvestEvent(supabase, interestEvent)
    ).rejects.toThrow('storage unavailable');
    expect(mockResolve).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ claimToken, status: 'failed' })
    );
  });

  it('retries a credit committed before a crash through the idempotent ledger', async () => {
    mockResolve.mockRejectedValueOnce(new Error('completion unavailable'));
    await expect(
      processPiggyvestEvent(supabase, interestEvent)
    ).rejects.toThrow('completion unavailable');
    const nextToken = '4204dc18-efb3-44d0-b9a2-1362448d4f22';
    mockClaim.mockResolvedValueOnce({
      outcome: 'claimed',
      claimToken: nextToken,
    });
    mockRecordPayout.mockResolvedValueOnce('duplicate');
    await expect(processPiggyvestEvent(supabase, interestEvent)).resolves.toBe(
      'processed'
    );
    expect(mockRecordPayout).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenLastCalledWith(supabase, {
      eventId: interestEvent.eventId,
      claimToken: nextToken,
      status: 'processed',
    });
  });
});
