import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAdminAuditAccess = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCreateClient = vi.fn();
const mockListAdminAuditEvents = vi.fn();
const mockWritePlatformAuditExportEvent = vi.fn();
const mockCreateAdminAuditCsv = vi.fn();

vi.mock('@/lib/admin-audit', () => ({
  listAdminAuditEvents: (...args: unknown[]) =>
    mockListAdminAuditEvents(...args),
}));
vi.mock('@/lib/admin-audit-access', () => ({
  getAdminAuditAccess: () => mockGetAdminAuditAccess(),
}));
vi.mock('@/lib/admin-audit-csv', () => ({
  createAdminAuditCsv: (...args: unknown[]) => mockCreateAdminAuditCsv(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/platform-audit-export', () => ({
  writePlatformAuditExportEvent: (...args: unknown[]) =>
    mockWritePlatformAuditExportEvent(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

import { POST } from './route';

const request = (body: unknown) =>
  new Request('http://localhost/api/admin/audit-events/export', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }) as NextRequest;

describe('/api/admin/audit-events/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminAuditAccess.mockResolvedValue({ status: 'authorized' });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCreateClient.mockResolvedValue({});
    mockListAdminAuditEvents.mockResolvedValue({
      data: { events: [], nextCursor: null },
      error: null,
    });
    mockWritePlatformAuditExportEvent.mockResolvedValue({
      data: 'event-id',
      error: null,
    });
    mockCreateAdminAuditCsv.mockReturnValue('Occurred at,Action\n');
  });

  it('requires CSRF validation before producing an export', async () => {
    mockCheckCsrfProtection.mockResolvedValue({ valid: false });

    const response = await POST(request({ source: 'all' }));

    expect(response.status).toBe(403);
    expect(mockListAdminAuditEvents).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON instead of exporting an unfiltered timeline', async () => {
    const response = await POST(
      new Request('http://localhost/api/admin/audit-events/export', {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }) as NextRequest
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid audit export query',
    });
    expect(mockListAdminAuditEvents).not.toHaveBeenCalled();
  });

  it('marks a complete capped export and records it before download', async () => {
    const response = await POST(request({ source: 'platform' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('x-baci-audit-export-scope')).toBe(
      'complete at query time'
    );
    expect(response.headers.get('content-disposition')).toContain(
      'baci-platform-audit.csv'
    );
    expect(mockListAdminAuditEvents).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ limit: 99, source: 'platform' })
    );
    expect(mockWritePlatformAuditExportEvent).toHaveBeenCalledWith({});
  });

  it('labels an export as partial when the bounded reader found more events', async () => {
    mockListAdminAuditEvents.mockResolvedValue({
      data: {
        events: [],
        nextCursor: {
          id: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
          occurredAt: '2026-08-05T10:00:00.000Z',
          source: 'platform',
        },
      },
      error: null,
    });

    const response = await POST(request({ source: 'platform' }));

    expect(response.headers.get('x-baci-audit-export-scope')).toBe(
      'partial; first 99 matching events'
    );
    expect(response.headers.get('content-disposition')).toContain(
      'baci-platform-audit-first-99-events.csv'
    );
  });

  it('does not record an export when CSV generation fails', async () => {
    mockCreateAdminAuditCsv.mockImplementation(() => {
      throw new Error('format failed');
    });

    const response = await POST(request({ source: 'platform' }));

    expect(response.status).toBe(500);
    expect(mockWritePlatformAuditExportEvent).not.toHaveBeenCalled();
  });
});
