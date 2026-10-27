import { describe, expect, it, vi } from 'vitest';
import { markManualDocumentDispatchStarted } from './mark-manual-document-dispatch-started';
import {
  merchant,
  order,
  payment,
  row,
  taxSubtotals,
  transactions,
} from './mark-manual-document-dispatch-started.test-fixture';

describe('markManualDocumentDispatchStarted RPC failure', () => {
  it('throws for retry when the RPC fails', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      markManualDocumentDispatchStarted(
        { rpc } as never,
        row,
        order as never,
        'receipt',
        payment,
        taxSubtotals,
        transactions,
        merchant,
        null
      )
    ).rejects.toThrow('Manual document dispatch state unavailable');
  });
});
