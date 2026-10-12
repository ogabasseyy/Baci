import { describe, expect, it, vi } from 'vitest';
import {
  checkManualDocumentDispatchLease,
  clearManualDocumentDispatchMarker,
  reclaimStaleManualDocumentDispatchMarker,
} from './check-manual-document-dispatch-lease';

function clientFor(result: { data: unknown; error: unknown }) {
  const builder = {
    from: vi.fn(() => builder),
    match: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    select: vi.fn(() => builder),
  };
  return builder;
}

const row = {
  id: 'outbox-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  event_type: 'manual_order_receipt',
  claim_owner: 'worker-1',
};

function queuedClient(results: { data: unknown; error: unknown }[]) {
  const queue = [...results];
  const builder = {
    from: vi.fn(() => builder),
    match: vi.fn(() => builder),
    maybeSingle: vi.fn(
      async () => queue.shift() ?? { data: null, error: null }
    ),
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
  };
  return builder;
}

describe('checkManualDocumentDispatchLease', () => {
  it('reports held when the dispatch marker is set', async () => {
    const client = clientFor({
      data: { dispatch_started_at: '2026-09-30T10:00:00Z' },
      error: null,
    });
    await expect(
      checkManualDocumentDispatchLease(client as never, 'outbox-1')
    ).resolves.toBe('held');
  });

  it('reports reset when a data change cleared the marker', async () => {
    const client = clientFor({
      data: { dispatch_started_at: null },
      error: null,
    });
    await expect(
      checkManualDocumentDispatchLease(client as never, 'outbox-1')
    ).resolves.toBe('reset');
  });

  it('reports unknown when the re-read fails', async () => {
    const client = clientFor({
      data: null,
      error: new Error('network lost'),
    });
    await expect(
      checkManualDocumentDispatchLease(client as never, 'outbox-1')
    ).resolves.toBe('unknown');
  });
});

describe('clearManualDocumentDispatchMarker', () => {
  it('clears without retrying when the write lands', async () => {
    const client = queuedClient([{ data: { id: 'outbox-1' }, error: null }]);
    await expect(
      clearManualDocumentDispatchMarker(client as never, row)
    ).resolves.toBeUndefined();
    expect(client.update).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures before the retry is scheduled', async () => {
    const client = queuedClient([
      { data: null, error: new Error('network lost') },
      { data: null, error: new Error('network lost') },
      { data: { id: 'outbox-1' }, error: null },
    ]);
    await expect(
      clearManualDocumentDispatchMarker(client as never, row)
    ).resolves.toBeUndefined();
    expect(client.update).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a lost lease without retrying', async () => {
    const client = queuedClient([{ data: null, error: null }]);
    await expect(
      clearManualDocumentDispatchMarker(client as never, row)
    ).rejects.toThrow('lease lost');
    expect(client.update).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries on persistent failures', async () => {
    const client = queuedClient([
      { data: null, error: new Error('down') },
      { data: null, error: new Error('down') },
      { data: null, error: new Error('down') },
    ]);
    await expect(
      clearManualDocumentDispatchMarker(client as never, row)
    ).rejects.toThrow('down');
    expect(client.update).toHaveBeenCalledTimes(3);
  });
});

describe('reclaimStaleManualDocumentDispatchMarker', () => {
  it('clears a marker stranded after a definite rejection', async () => {
    const client = queuedClient([
      {
        data: {
          dispatch_started_at: '2026-09-30T10:00:00Z',
          last_error: 'dispatch_marker_clear_failed',
        },
        error: null,
      },
      { data: { id: 'outbox-1' }, error: null },
    ]);
    await expect(
      reclaimStaleManualDocumentDispatchMarker(client as never, row)
    ).resolves.toBeUndefined();
    expect(client.update).toHaveBeenCalledTimes(1);
  });

  it('leaves a clean retry alone', async () => {
    const client = queuedClient([
      {
        data: { dispatch_started_at: null, last_error: 'timeout' },
        error: null,
      },
    ]);
    await expect(
      reclaimStaleManualDocumentDispatchMarker(client as never, row)
    ).resolves.toBeUndefined();
    expect(client.update).not.toHaveBeenCalled();
  });

  it('leaves a crash-stranded marker for the claim to fail closed', async () => {
    const client = queuedClient([
      {
        data: {
          dispatch_started_at: '2026-09-30T10:00:00Z',
          last_error: 'timeout',
        },
        error: null,
      },
    ]);
    await expect(
      reclaimStaleManualDocumentDispatchMarker(client as never, row)
    ).resolves.toBeUndefined();
    expect(client.update).not.toHaveBeenCalled();
  });

  it('preserves the signal when the reclaim read fails', async () => {
    const client = queuedClient([
      { data: null, error: new Error('network lost') },
    ]);
    await expect(
      reclaimStaleManualDocumentDispatchMarker(client as never, row)
    ).rejects.toThrow('dispatch_marker_clear_failed');
  });

  it('preserves the signal when the reclaim clear fails', async () => {
    const client = queuedClient([
      {
        data: {
          dispatch_started_at: '2026-09-30T10:00:00Z',
          last_error: 'dispatch_marker_clear_failed',
        },
        error: null,
      },
      { data: null, error: new Error('down') },
      { data: null, error: new Error('down') },
      { data: null, error: new Error('down') },
    ]);
    await expect(
      reclaimStaleManualDocumentDispatchMarker(client as never, row)
    ).rejects.toThrow('dispatch_marker_clear_failed');
  });
});
