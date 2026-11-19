import { describe, expect, it } from 'vitest';
import { createPendingTransactionSupabaseMock } from './vtu-fulfillment.test-support';

type QueryResult = { data: unknown; error: unknown };

describe('createPendingTransactionSupabaseMock', () => {
  it('reads the scripted transaction row from vtu_transactions', async () => {
    const transactionRow = { id: 'vtu-1', status: 'pending' };
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow,
    }) as unknown as {
      from: (table: string) => {
        select: (columns?: string) => {
          eq: () => { single: () => Promise<QueryResult> };
        };
      };
    };

    await expect(
      supabase.from('vtu_transactions').select('id').eq().single()
    ).resolves.toEqual({ data: transactionRow, error: null });
  });

  it('shares one update handler across lookups so scripted failures persist', async () => {
    const failure = { message: 'write failed' };
    const supabase = createPendingTransactionSupabaseMock({
      purchaseUpdateErrors: [failure, null],
      transactionRow: { id: 'vtu-1' },
    }) as unknown as {
      from: (table: string) => {
        update: (payload: unknown) => Promise<QueryResult>;
      };
    };

    const first = await supabase
      .from('vtu_transactions')
      .update({ status: 'failed', metadata: {} });
    const second = await supabase
      .from('vtu_transactions')
      .update({ status: 'failed', metadata: {} });

    expect(first.error).toEqual(failure);
    expect(second.error).toBeNull();
  });
});
