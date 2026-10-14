import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeVtuSettlementMetadata } from './vtu-settlement-metadata';

interface ChainMocks {
  casEqUpdatedAt: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  maybeSingleCas: ReturnType<typeof vi.fn>;
  maybeSingleReread: ReturnType<typeof vi.fn>;
  updatePayloads: unknown[];
}

function createSupabaseMock({
  casResults = [{ id: 'vtu-1' }],
  rereadData = { metadata: {}, updated_at: 't1' },
  rereadError = null,
}: {
  casResults?: Array<{ id: string } | null>;
  rereadData?: { metadata: unknown; updated_at: string } | null;
  rereadError?: { message: string } | null;
} = {}): { mocks: ChainMocks; supabase: SupabaseClient } {
  const updatePayloads: unknown[] = [];
  const maybeSingleReread = vi
    .fn()
    .mockResolvedValue({ data: rereadData, error: rereadError });
  const maybeSingleCas = vi.fn();
  for (const result of casResults) {
    maybeSingleCas.mockResolvedValueOnce({ data: result, error: null });
  }
  const casEqUpdatedAt = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ maybeSingle: maybeSingleCas }),
  });
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleReread }),
    }),
    update: vi.fn((payload: unknown) => {
      updatePayloads.push(payload);
      return {
        eq: vi.fn().mockReturnValue({ eq: casEqUpdatedAt }),
      };
    }),
  });
  return {
    mocks: {
      casEqUpdatedAt,
      from,
      maybeSingleCas,
      maybeSingleReread,
      updatePayloads,
    },
    supabase: { from } as unknown as SupabaseClient,
  };
}

describe('mergeVtuSettlementMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges owned keys onto fresh metadata preserving foreign keys', async () => {
    // Codex R82 P2: the concurrent winner's notification claim (or
    // credit flags) must survive this execution's settlement write.
    const { mocks, supabase } = createSupabaseMock({
      rereadData: {
        metadata: {
          merchantWalletCredited: false,
          customerNotificationAttempted: 'sent-at',
        },
        updated_at: 't2',
      },
    });

    const result = await mergeVtuSettlementMetadata({
      baselineMetadata: { merchantWalletCredited: false },
      mutatedMetadata: { merchantWalletCredited: true },
      rowId: 'vtu-1',
      supabase,
    });

    expect(result).toBe('persisted');
    expect(mocks.updatePayloads).toEqual([
      {
        metadata: {
          merchantWalletCredited: true,
          customerNotificationAttempted: 'sent-at',
        },
      },
    ]);
    expect(mocks.casEqUpdatedAt).toHaveBeenCalledWith('updated_at', 't2');
  });

  it('retries once on a lost CAS race then gives up without throwing', async () => {
    // Give-up is safe: credit RPCs already landed idempotently and
    // unpersisted flags re-select the row on the next cron tick.
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { mocks, supabase } = createSupabaseMock({
      casResults: [null, null],
    });
    try {
      const result = await mergeVtuSettlementMetadata({
        baselineMetadata: {},
        mutatedMetadata: { merchantWalletCredited: true },
        rowId: 'vtu-1',
        supabase,
      });

      expect(result).toBe('skipped-race-lost');
      expect(mocks.maybeSingleCas).toHaveBeenCalledTimes(2);
      expect(mocks.maybeSingleReread).toHaveBeenCalledTimes(2);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('persists on the second attempt after one lost race', async () => {
    const { mocks, supabase } = createSupabaseMock({
      casResults: [null, { id: 'vtu-1' }],
    });

    const result = await mergeVtuSettlementMetadata({
      baselineMetadata: {},
      mutatedMetadata: { merchantWalletCredited: true },
      rowId: 'vtu-1',
      supabase,
    });

    expect(result).toBe('persisted');
    expect(mocks.maybeSingleCas).toHaveBeenCalledTimes(2);
  });

  it('skips the write when settlement changed nothing', async () => {
    const { mocks, supabase } = createSupabaseMock();

    const result = await mergeVtuSettlementMetadata({
      baselineMetadata: { merchantWalletCredited: false },
      mutatedMetadata: { merchantWalletCredited: false },
      rowId: 'vtu-1',
      supabase,
    });

    expect(result).toBe('persisted');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('gives up without throwing when the re-read fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { mocks, supabase } = createSupabaseMock({
      rereadData: null,
      rereadError: { message: 'read failed' },
    });
    try {
      const result = await mergeVtuSettlementMetadata({
        baselineMetadata: {},
        mutatedMetadata: { merchantWalletCredited: true },
        rowId: 'vtu-1',
        supabase,
      });

      expect(result).toBe('skipped-race-lost');
      expect(mocks.updatePayloads).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
