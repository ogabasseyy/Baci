import { describe, expect, it, vi } from 'vitest';
import { reportFailedManualDocumentSend } from './report-failed-manual-document-send';

describe('reportFailedManualDocumentSend', () => {
  it('clears the marker on a definite rejection', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const outcome = await reportFailedManualDocumentSend(
      { success: false, error: 'rejected' },
      clear
    );
    expect(clear).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'failed', error: 'rejected' });
  });

  it('keeps the marker on an unknown outcome', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const outcome = await reportFailedManualDocumentSend(
      { success: false, deliveryOutcome: 'unknown' },
      clear
    );
    expect(clear).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'failed',
      error: 'Document email failed',
      deliveryOutcome: 'unknown',
    });
  });

  it('reports a marker-clear failure', async () => {
    const clear = vi.fn().mockRejectedValue(new Error('db down'));
    const outcome = await reportFailedManualDocumentSend(
      { success: false, error: 'rejected' },
      clear
    );
    expect(outcome).toEqual({
      status: 'failed',
      error: 'dispatch_marker_clear_failed',
    });
  });
});
