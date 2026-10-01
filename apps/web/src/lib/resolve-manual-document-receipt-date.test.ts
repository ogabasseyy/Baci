import { describe, expect, it, vi } from 'vitest';
import { resolveManualDocumentReceiptDate } from './resolve-manual-document-receipt-date';

function clientReturning(result: unknown) {
  const terminal = { maybeSingle: vi.fn().mockResolvedValue(result) };
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(terminal),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from }, from };
}

describe('resolveManualDocumentReceiptDate', () => {
  it('returns the newest completed payment timestamp', async () => {
    const { client, from } = clientReturning({
      data: { created_at: '2026-09-29T12:00:00Z' },
      error: null,
    });

    await expect(
      resolveManualDocumentReceiptDate(client as never, 'order-1', true)
    ).resolves.toBe('2026-09-29T12:00:00Z');
    expect(from).toHaveBeenCalledWith('transactions');
  });

  it('returns null without querying for unpaid orders', async () => {
    const { client, from } = clientReturning({ data: null, error: null });

    await expect(
      resolveManualDocumentReceiptDate(client as never, 'order-1', false)
    ).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when the lookup fails', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      resolveManualDocumentReceiptDate(client as never, 'order-1', true)
    ).resolves.toBeNull();
  });
});
