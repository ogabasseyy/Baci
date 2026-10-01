import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
const auditMock = vi.fn();
const csrfMock = vi.fn();
const reconciliationMock = vi.fn();

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) => authMock(...args),
}));
vi.mock('@/lib/admin-reconciliation', () => ({
  getAdminReconciliation: (...args: unknown[]) => reconciliationMock(...args),
}));
vi.mock('@/lib/admin-reconciliation-export-audit', () => ({
  writeAdminReconciliationExportEvent: (...args: unknown[]) =>
    auditMock(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => csrfMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));

import { GET, POST } from './route';

const data = {
  currency: 'NGN',
  generatedAt: '2026-08-05T10:00:00.000Z',
  items: [],
  metrics: {},
  nextCursor: null,
  periodStart: '2026-07-06T10:00:00.000Z',
  supportedCurrencies: ['NGN'],
};

describe('GET /api/admin/reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditMock.mockResolvedValue({ data: 'audit-id', error: null });
    csrfMock.mockResolvedValue({ valid: true });
  });

  it('rejects unauthenticated callers before reading the model', async () => {
    authMock.mockResolvedValue({ status: 'unauthenticated' });
    const response = await GET(
      new NextRequest('http://localhost/api/admin/reconciliation')
    );

    expect(response.status).toBe(401);
    expect(reconciliationMock).not.toHaveBeenCalled();
  });

  it('requires the financial read permission', async () => {
    authMock.mockResolvedValue({ status: 'forbidden' });
    const response = await GET(
      new NextRequest('http://localhost/api/admin/reconciliation')
    );

    expect(response.status).toBe(403);
    expect(authMock).toHaveBeenCalledWith('financials.read');
  });

  it('rejects an invalid filter before calling the RPC', async () => {
    authMock.mockResolvedValue({ status: 'authenticated' });
    const response = await GET(
      new NextRequest(
        'http://localhost/api/admin/reconciliation?currency=NGN&lane=legacy_payout'
      )
    );

    expect(response.status).toBe(400);
    expect(reconciliationMock).not.toHaveBeenCalled();
  });

  it('requires an explicit currency rather than assuming NGN in the API', async () => {
    authMock.mockResolvedValue({ status: 'authenticated' });
    const response = await GET(
      new NextRequest('http://localhost/api/admin/reconciliation')
    );

    expect(response.status).toBe(400);
    expect(reconciliationMock).not.toHaveBeenCalled();
  });

  it('keeps GET read-only when a caller requests CSV', async () => {
    authMock.mockResolvedValue({ status: 'authenticated' });
    const response = await GET(
      new NextRequest(
        'http://localhost/api/admin/reconciliation?currency=NGN&format=csv&limit=100'
      )
    );

    expect(response.status).toBe(400);
    expect(reconciliationMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('requires CSRF validation before preparing a CSV export', async () => {
    authMock.mockResolvedValue({ status: 'authenticated' });
    csrfMock.mockResolvedValue({ valid: false });
    const response = await POST(
      new NextRequest('http://localhost/api/admin/reconciliation', {
        body: JSON.stringify({ currency: 'NGN', format: 'csv' }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(403);
    expect(reconciliationMock).not.toHaveBeenCalled();
  });

  it('returns a bounded CSV export through the safe projection', async () => {
    authMock.mockResolvedValue({ status: 'authenticated' });
    reconciliationMock.mockResolvedValue({ data, error: null });
    const response = await POST(
      new NextRequest('http://localhost/api/admin/reconciliation', {
        body: JSON.stringify({ currency: 'NGN', format: 'csv', limit: 100 }),
        method: 'POST',
      })
    );

    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(reconciliationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ currency: 'NGN', format: 'csv', limit: 100 })
    );
    expect(auditMock).toHaveBeenCalledOnce();
    expect(response.headers.get('x-baci-export-scope')).toBe(
      'first-100-matching-rows'
    );
  });

  it('fails closed when the fixed audit event cannot be written', async () => {
    authMock.mockResolvedValue({ status: 'authenticated' });
    reconciliationMock.mockResolvedValue({ data, error: null });
    auditMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'denied' },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/reconciliation', {
        body: JSON.stringify({ currency: 'NGN', format: 'csv', limit: 100 }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
