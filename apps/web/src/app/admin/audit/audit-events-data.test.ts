import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuditEvents } from './audit-events-data';

describe('loadAuditEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes filters and the pagination cursor in the audit request', async () => {
    const response = {
      data: { events: [], nextCursor: null },
      generatedAt: '',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => response, ok: true })
    );

    await loadAuditEvents(
      {
        action: 'audit.exported',
        resourceType: 'audit_timeline',
        source: 'platform',
      },
      {
        id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
        occurredAt: '2026-08-05T10:00:00.000Z',
        source: 'platform',
      }
    );

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/audit-events?limit=50&source=platform&action=audit.exported&resourceType=audit_timeline&beforeOccurredAt=2026-08-05T10%3A00%3A00.000Z&beforeSource=platform&beforeId=d8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1'
    );
  });
});
