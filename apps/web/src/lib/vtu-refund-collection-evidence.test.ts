import { describe, expect, it, vi } from 'vitest';
import {
  hasVtuCollectionEvidence,
  shouldSkipRefundWithoutCollectionEvidence,
} from './vtu-refund-collection-evidence';

describe('hasVtuCollectionEvidence', () => {
  const row = {
    customer_id: 'customer-1',
    id: 'vtu-1',
    merchant_id: 'merchant-1',
  };

  function buildSupabase({
    ledgerData = null,
    ledgerError = null,
    transactionResponses = [],
  }: {
    ledgerData?: unknown;
    ledgerError?: { message: string } | null;
    transactionResponses?: Array<{
      data: Array<{ status: string }>;
      error: { message: string } | null;
    }>;
  } = {}) {
    const ledgerChain: Record<string, unknown> = {};
    ledgerChain.eq = vi.fn(() => ledgerChain);
    ledgerChain.limit = vi.fn(() => ledgerChain);
    ledgerChain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: ledgerData, error: ledgerError })
    );
    ledgerChain.order = vi.fn(() => ledgerChain);
    let txCursor = 0;
    const eqArgs: [string, unknown][] = [];
    const from = vi.fn((table: string) => {
      if (table === 'customer_wallet_transactions') {
        return { select: vi.fn(() => ledgerChain) };
      }
      if (table === 'transactions') {
        // Awaited directly (no terminal maybeSingle): every .eq
        // returns the awaitable terminal response, one queued
        // response per select() call (reference, order, metadata).
        return {
          select: vi.fn(() => {
            const response = transactionResponses[txCursor++] ?? {
              data: [],
              error: null,
            };
            const terminal = Object.assign(Promise.resolve(response), {
              eq: vi.fn((column: string, value: unknown) => {
                eqArgs.push([column, value]);
                return terminal;
              }),
            });
            return { eq: terminal.eq };
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    return { eqArgs, from, supabase: { from } as never };
  }

  const statusResponse = (status: string) => ({
    data: [{ status }],
    error: null,
  });

  it('accepts the wallet-debit flag without any reads', async () => {
    const { from, supabase } = buildSupabase();

    await expect(
      hasVtuCollectionEvidence({
        metadata: { walletDebited: true },
        row,
        supabase,
      })
    ).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('accepts a provider reference without any reads', async () => {
    // References persist only from provider responses, and every
    // flow collects before its first provider call — so a reference
    // proves collection preceded the vend attempt.
    const { from, supabase } = buildSupabase();

    await expect(
      hasVtuCollectionEvidence({
        metadata: {},
        row: { ...row, transaction_id: 'kuda-ref-1' },
        supabase,
      })
    ).resolves.toBe(true);
    await expect(
      hasVtuCollectionEvidence({
        metadata: { monnifyVendReference: 'VEND-1' },
        row: { ...row, transaction_id: null },
        supabase,
      })
    ).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('accepts a wallet-ledger redemption for the transaction', async () => {
    const { from, supabase } = buildSupabase({
      ledgerData: { id: 'ledger-debit-1' },
    });

    await expect(
      hasVtuCollectionEvidence({ metadata: {}, row, supabase })
    ).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('customer_wallet_transactions');
    expect(from).not.toHaveBeenCalledWith('transactions');
  });

  it('accepts a completed gateway transaction for the payment reference', async () => {
    const { eqArgs, from, supabase } = buildSupabase({
      transactionResponses: [
        { data: [{ status: 'failed' }, { status: 'completed' }], error: null },
      ],
    });

    await expect(
      hasVtuCollectionEvidence({
        metadata: { paymentReference: 'PAY-1' },
        row,
        supabase,
      })
    ).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('transactions');
    expect(eqArgs).toContainEqual(['gateway_reference', 'PAY-1']);
  });

  it('accepts a completed order transaction when no reference is stored', async () => {
    // Saved-card path: the reference lives on the transactions row
    // only, so link by order_id instead.
    const { eqArgs, supabase } = buildSupabase({
      transactionResponses: [statusResponse('completed')],
    });

    await expect(
      hasVtuCollectionEvidence({
        metadata: {},
        row: { ...row, order_id: 'order-1' },
        supabase,
      })
    ).resolves.toBe(true);
    expect(eqArgs).toContainEqual(['order_id', 'order-1']);
  });

  it('accepts a completed metadata-linked gateway transaction', async () => {
    // Legacy charge shape (Codex R54 6rrFRE): no paymentReference on
    // the VTU row, order_id null, no provider reference — the only
    // link is transactions.metadata.vtu_transaction_id.
    const { eqArgs, supabase } = buildSupabase({
      transactionResponses: [statusResponse('completed')],
    });

    await expect(
      hasVtuCollectionEvidence({
        metadata: {},
        row: { ...row, order_id: null, transaction_id: null },
        supabase,
      })
    ).resolves.toBe(true);
    expect(eqArgs).toContainEqual(['metadata->>vtu_transaction_id', 'vtu-1']);
  });

  it('rejects missing links and non-completed gateway rows', async () => {
    // No reference/order link: only the metadata branch runs, and an
    // empty result is not evidence.
    const noRef = buildSupabase();
    await expect(
      hasVtuCollectionEvidence({ metadata: {}, row, supabase: noRef.supabase })
    ).resolves.toBe(false);
    expect(noRef.eqArgs).toContainEqual([
      'metadata->>vtu_transaction_id',
      'vtu-1',
    ]);

    // Links present but no completed transaction: declined and
    // pending gateway rows never collected.
    for (const statuses of [[], ['failed'], ['pending', 'cancelled']]) {
      const queued = {
        data: statuses.map((status) => ({ status })),
        error: null,
      };
      const { supabase } = buildSupabase({
        transactionResponses: [queued, queued, queued],
      });
      await expect(
        hasVtuCollectionEvidence({
          metadata: { paymentReference: 'PAY-1' },
          row: { ...row, order_id: 'order-1' },
          supabase,
        })
      ).resolves.toBe(false);
    }
  });

  it('throws (fail closed) when an evidence read fails', async () => {
    const { supabase: ledgerDown } = buildSupabase({
      ledgerError: { message: 'db down' },
    });
    await expect(
      hasVtuCollectionEvidence({ metadata: {}, row, supabase: ledgerDown })
    ).rejects.toThrow('Failed to verify VTU debit ledger');

    const { supabase: gatewayDown } = buildSupabase({
      transactionResponses: [{ data: [], error: { message: 'db down' } }],
    });
    await expect(
      hasVtuCollectionEvidence({
        metadata: { paymentReference: 'PAY-1' },
        row,
        supabase: gatewayDown,
      })
    ).rejects.toThrow('Failed to verify gateway collection evidence');

    const { supabase: orderDown } = buildSupabase({
      transactionResponses: [{ data: [], error: { message: 'db down' } }],
    });
    await expect(
      hasVtuCollectionEvidence({
        metadata: {},
        row: { ...row, order_id: 'order-1' },
        supabase: orderDown,
      })
    ).rejects.toThrow('Failed to verify order collection evidence');

    const { supabase: metadataDown } = buildSupabase({
      transactionResponses: [{ data: [], error: { message: 'db down' } }],
    });
    await expect(
      hasVtuCollectionEvidence({ metadata: {}, row, supabase: metadataDown })
    ).rejects.toThrow('Failed to verify metadata-linked collection evidence');
  });

  it('skips card-only refunds only without collection evidence', async () => {
    // Moved with the helper from vtu-fulfillment-recovery (Codex
    // R106 P1); exercises the real evidence check instead of a
    // module-boundary mock.
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { supabase: debited } = buildSupabase();
      await expect(
        shouldSkipRefundWithoutCollectionEvidence({
          metadata: { walletDebited: true },
          row,
          supabase: debited as never,
        })
      ).resolves.toBe(false);

      const { supabase: bare } = buildSupabase();
      await expect(
        shouldSkipRefundWithoutCollectionEvidence({
          metadata: {},
          row,
          supabase: bare as never,
        })
      ).resolves.toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('no collection evidence'),
        expect.objectContaining({ transactionId: 'vtu-1' })
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
