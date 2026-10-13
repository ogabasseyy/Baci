import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasExistingVtuDebitLedger: vi.fn(),
  hasVtuCollectionEvidence: vi.fn(),
  isFlaggedReferenceLessVtuRow: vi.fn(),
  isMarkedUnsubmittedMonnifyVtuRow: vi.fn(),
  isStrandedPreVendVtuRow: vi.fn(),
  isUnsubmittedPreparedVtuRow: vi.fn(),
  markVtuProviderSubmissionStarted: vi.fn(),
  restoreInterruptedPreVendVtuRow: vi.fn(),
}));

vi.mock('@/lib/vtu-debit-ledger-lookup', () => ({
  hasExistingVtuDebitLedger: mocks.hasExistingVtuDebitLedger,
}));
vi.mock('@/lib/vtu-flagged-recovery', () => ({
  isFlaggedReferenceLessVtuRow: mocks.isFlaggedReferenceLessVtuRow,
  isMarkedUnsubmittedMonnifyVtuRow: mocks.isMarkedUnsubmittedMonnifyVtuRow,
  isUnsubmittedPreparedVtuRow: mocks.isUnsubmittedPreparedVtuRow,
}));
vi.mock('@/lib/vtu-pre-vend-recovery', () => ({
  isStrandedPreVendVtuRow: mocks.isStrandedPreVendVtuRow,
  restoreInterruptedPreVendVtuRow: mocks.restoreInterruptedPreVendVtuRow,
}));
vi.mock('@/lib/vtu-refund-collection-evidence', () => ({
  hasVtuCollectionEvidence: mocks.hasVtuCollectionEvidence,
}));
vi.mock('@/lib/vtu-submission-marker', () => ({
  markVtuProviderSubmissionStarted: mocks.markVtuProviderSubmissionStarted,
}));

import type { VtuTransactionRow } from '@/lib/vtu-fulfillment';
import { VtuPersistenceError } from '@/lib/vtu-persistence-error';
import {
  recoverStrandedPreVendVtuRow,
  shouldSkipRefundWithoutCollectionEvidence,
  writeVtuProviderSubmissionMarkerOrRestore,
} from './vtu-fulfillment-recovery';

const row = { id: 'vtu-1' } as VtuTransactionRow;
const supabase = {} as unknown as SupabaseClient;

describe('vtu-fulfillment-recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasExistingVtuDebitLedger.mockResolvedValue(false);
    mocks.hasVtuCollectionEvidence.mockResolvedValue(true);
    mocks.isFlaggedReferenceLessVtuRow.mockReturnValue(false);
    mocks.isMarkedUnsubmittedMonnifyVtuRow.mockReturnValue(false);
    mocks.isStrandedPreVendVtuRow.mockReturnValue(false);
    mocks.isUnsubmittedPreparedVtuRow.mockReturnValue(false);
    mocks.markVtuProviderSubmissionStarted.mockResolvedValue(null);
    mocks.restoreInterruptedPreVendVtuRow.mockResolvedValue(undefined);
  });

  it('restores ledger-backed strands and continues', async () => {
    mocks.isStrandedPreVendVtuRow.mockReturnValue(true);
    mocks.hasExistingVtuDebitLedger.mockResolvedValue(true);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
      expect.objectContaining({
        row,
        userSafeMessage: expect.stringContaining('stranded pre-vend'),
      })
    );
  });

  it('leaves never-debited strands for support (fail closed)', async () => {
    mocks.isStrandedPreVendVtuRow.mockReturnValue(true);
    mocks.hasExistingVtuDebitLedger.mockResolvedValue(false);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it.each([
    ['isUnsubmittedPreparedVtuRow', 'unsubmitted prepared'],
    ['isMarkedUnsubmittedMonnifyVtuRow', 'marked unsubmitted Monnify'],
  ])('restores %s rows for re-drive', async (predicate, messagePart) => {
    mocks[predicate as 'isUnsubmittedPreparedVtuRow'].mockReturnValue(true);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
      expect.objectContaining({
        userSafeMessage: expect.stringContaining(messagePart as string),
      })
    );
  });

  it('routes flagged reference-less rows to provider-truth settlement', async () => {
    mocks.isFlaggedReferenceLessVtuRow.mockReturnValue(true);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('settle-from-provider');
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it('continues past ordinary rows without restoring', async () => {
    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it('marker success resolves without restoring', async () => {
    await expect(
      writeVtuProviderSubmissionMarkerOrRestore({ row, supabase })
    ).resolves.toBeUndefined();
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it('marker failure restores then throws persistence error', async () => {
    mocks.markVtuProviderSubmissionStarted.mockResolvedValue({
      message: 'connection reset',
    });

    await expect(
      writeVtuProviderSubmissionMarkerOrRestore({ row, supabase })
    ).rejects.toBeInstanceOf(VtuPersistenceError);
    expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
      expect.objectContaining({ row })
    );
  });

  it('skips card-only refunds only without collection evidence', async () => {
    const metadata = {};
    await expect(
      shouldSkipRefundWithoutCollectionEvidence({ metadata, row, supabase })
    ).resolves.toBe(false);

    mocks.hasVtuCollectionEvidence.mockResolvedValue(false);
    await expect(
      shouldSkipRefundWithoutCollectionEvidence({ metadata, row, supabase })
    ).resolves.toBe(true);
  });
});
