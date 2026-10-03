import { describe, expect, it, vi } from 'vitest';
import { checkManualDocumentDispatchLease } from './check-manual-document-dispatch-lease';

function clientFor(result: { data: unknown; error: unknown }) {
  const builder = {
    from: vi.fn(() => builder),
    match: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    select: vi.fn(() => builder),
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
