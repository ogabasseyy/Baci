import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAdminAuditAccess = vi.fn();
const mockCreateClient = vi.fn();
const mockListAdminAuditEvents = vi.fn();

vi.mock('@/lib/admin-audit', () => ({
  listAdminAuditEvents: (...args: unknown[]) =>
    mockListAdminAuditEvents(...args),
}));
vi.mock('@/lib/admin-audit-access', () => ({
  getAdminAuditAccess: () => mockGetAdminAuditAccess(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

import { GET } from './route';

const url = 'http://localhost/api/admin/audit-events';
const request = (query = '') => new Request(`${url}${query}`) as NextRequest;

describe('/api/admin/audit-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminAuditAccess.mockResolvedValue({ status: 'authorized' });
    mockCreateClient.mockResolvedValue({});
    mockListAdminAuditEvents.mockResolvedValue({
      data: { events: [], nextCursor: null },
      error: null,
    });
  });

  it('denies unauthenticated callers before database work', async () => {
    mockGetAdminAuditAccess.mockResolvedValue({ status: 'unauthenticated' });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockListAdminAuditEvents).not.toHaveBeenCalled();
  });

  it('rejects a partial keyset cursor before database work', async () => {
    const response = await GET(
      request('?beforeOccurredAt=2026-08-05T10%3A00%3A00.000Z')
    );

    expect(response.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns only the safe reader response with no-store caching', async () => {
    const response = await GET(request('?source=platform&limit=50'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mockListAdminAuditEvents).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ limit: 50, source: 'platform' })
    );
  });
});
