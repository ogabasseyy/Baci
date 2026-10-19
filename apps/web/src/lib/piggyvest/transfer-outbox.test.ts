import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  applyOutflowTerminal,
  outflowReferenceCandidates,
  recordTransferSubmission,
} from './transfer-outbox';

function thenable(result: unknown) {
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  return { then };
}

function mockSupabase(
  updateResults: Array<{ data: unknown; error: unknown }>
): {
  client: SupabaseClient;
  eq: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
} {
  const queue = [...updateResults];
  const select = vi.fn(() =>
    thenable(queue.shift() ?? { data: [], error: null })
  );
  const eq = vi.fn(() => ({ eq, select }));
  const update = vi.fn(() => ({ eq }));
  const upsert = vi.fn(() => ({ select }));
  return {
    client: {
      from: vi.fn(() => ({ eq, select, update, upsert })),
    } as unknown as SupabaseClient,
    eq,
    upsert,
  };
}

const submission = {
  reference: 'ref-synthetic-001',
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchantId: '43e157b6-179c-432a-9392-e0827da96d82',
  walletId: 'pvb-wallet-synthetic-001',
  amountKobo: 500000,
  direction: 'bank' as const,
  destinationRef: '058:6789',
};

describe('recordTransferSubmission', () => {
  it('records a submission keyed by our reference', async () => {
    const { client, upsert } = mockSupabase([
      { data: [{ reference: 'ref-synthetic-001' }], error: null },
    ]);

    await expect(recordTransferSubmission(client, submission)).resolves.toBe(
      'recorded'
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'ref-synthetic-001',
        status: 'submitted',
      }),
      { onConflict: 'reference', ignoreDuplicates: true }
    );
  });

  it('collapses duplicate submissions on the reference', async () => {
    const { client } = mockSupabase([{ data: [], error: null }]);

    await expect(recordTransferSubmission(client, submission)).resolves.toBe(
      'duplicate'
    );
  });
});

describe('applyOutflowTerminal', () => {
  it('flips only from submitted so the first terminal state wins', async () => {
    const { client, eq } = mockSupabase([
      { data: [{ reference: 'ref-synthetic-001' }], error: null },
    ]);

    await expect(
      applyOutflowTerminal(client, {
        references: ['ref-synthetic-001'],
        status: 'succeeded',
      })
    ).resolves.toBe('matched');
    expect(eq).toHaveBeenCalledWith('reference', 'ref-synthetic-001');
    expect(eq).toHaveBeenCalledWith('status', 'submitted');
  });

  it('tries candidates in order until one matches', async () => {
    const { client } = mockSupabase([
      { data: [], error: null },
      { data: [{ reference: 'ref-synthetic-002' }], error: null },
    ]);

    await expect(
      applyOutflowTerminal(client, {
        references: ['ref-unknown', 'ref-synthetic-002'],
        status: 'failed',
      })
    ).resolves.toBe('matched');
  });

  it('returns unmatched when we submitted none of the candidates', async () => {
    const { client } = mockSupabase([{ data: [], error: null }]);

    await expect(
      applyOutflowTerminal(client, {
        references: ['ref-unknown'],
        status: 'succeeded',
      })
    ).resolves.toBe('unmatched');
  });
});

describe('outflowReferenceCandidates', () => {
  it('collects string references most-specific first, skipping the rest', () => {
    expect(
      outflowReferenceCandidates({
        reference: 'ref-001',
        initiator_reference: 'init-001',
        internal_reference: 42,
        third_party_reference: '',
        other: 'ignored',
      })
    ).toEqual(['ref-001', 'init-001']);
  });

  it('returns empty when no usable reference exists', () => {
    expect(outflowReferenceCandidates({})).toEqual([]);
  });
});
