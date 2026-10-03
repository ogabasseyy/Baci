import { describe, expect, it, vi } from 'vitest';
import {
  resolveManualDocumentReceiptDate,
  selectReceiptCompletionDate,
} from './resolve-manual-document-receipt-date';

function clientReturning(result: unknown) {
  const terminal = { maybeSingle: vi.fn().mockResolvedValue(result) };
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(terminal),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from }, from, chain };
}

describe('resolveManualDocumentReceiptDate', () => {
  it('returns the newest completed payment timestamp', async () => {
    const { client, from, chain } = clientReturning({
      data: { created_at: '2026-09-29T12:00:00Z' },
      error: null,
    });

    await expect(
      resolveManualDocumentReceiptDate(client as never, 'order-1', true)
    ).resolves.toBe('2026-09-29T12:00:00Z');
    expect(from).toHaveBeenCalledWith('transactions');
    expect(chain.in).toHaveBeenCalledWith('status', ['completed', 'success']);
    // Nulls sort first on descending order: push them last so a
    // null-created payment cannot shadow the newest dated one.
    expect(chain.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
      nullsFirst: false,
    });
  });

  it('returns null without querying for unpaid orders', async () => {
    const { client, from } = clientReturning({ data: null, error: null });

    await expect(
      resolveManualDocumentReceiptDate(client as never, 'order-1', false)
    ).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('throws when the lookup fails so the outbox retry re-reads', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      resolveManualDocumentReceiptDate(client as never, 'order-1', true)
    ).rejects.toThrow('Manual document receipt date unavailable');
  });
});

describe('selectReceiptCompletionDate', () => {
  it('selects the newest settled payment and skips unsettled rows', () => {
    expect(
      selectReceiptCompletionDate([
        {
          created_at: '2026-09-28T12:00:00Z',
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          created_at: '2026-09-29T12:00:00Z',
          status: 'success',
          transaction_type: 'payment',
        },
        {
          created_at: '2026-09-30T12:00:00Z',
          status: 'pending',
          transaction_type: 'payment',
        },
        {
          created_at: '2026-09-30T12:00:00Z',
          status: 'success',
          transaction_type: 'refund',
        },
      ])
    ).toBe('2026-09-29T12:00:00Z');
  });

  it('prefers dated rows over null timestamps and empty sets', () => {
    expect(
      selectReceiptCompletionDate([
        { created_at: null, status: 'completed', transaction_type: 'payment' },
        {
          created_at: '2026-09-29T12:00:00Z',
          status: 'completed',
          transaction_type: 'payment',
        },
      ])
    ).toBe('2026-09-29T12:00:00Z');
    expect(selectReceiptCompletionDate([])).toBeNull();
    expect(
      selectReceiptCompletionDate([
        { created_at: null, status: 'completed', transaction_type: 'payment' },
      ])
    ).toBeNull();
  });
});
