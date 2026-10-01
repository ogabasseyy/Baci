import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAccessAuth = vi.fn();
const mockCsrf = vi.fn();
const mockCreateClient = vi.fn();
const mockList = vi.fn();
const mockRevoke = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/lib/admin-platform-access', () => ({
  listAdminPlatformAccess: (...args: unknown[]) => mockList(...args),
  revokeAdminPlatformAccess: (...args: unknown[]) => mockRevoke(...args),
  upsertAdminPlatformAccess: (...args: unknown[]) => mockUpsert(...args),
}));
vi.mock('@/lib/admin-platform-access-auth', () => ({
  getAdminPlatformAccessAuth: () => mockAccessAuth(),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCsrf(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

import { DELETE, GET, POST } from './route';

const member = {
  created_at: '2026-08-05T10:00:00.000Z',
  email: 'owner@example.test',
  granted_at: '2026-08-05T10:00:00.000Z',
  is_legacy_owner: false,
  is_revocable: true,
  reason: 'Operational access',
  revoked_at: null,
  role: 'owner',
  status: 'active',
  updated_at: '2026-08-05T10:00:00.000Z',
};

function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/admin/access', {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    method,
  }) as NextRequest;
}

describe('/api/admin/access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessAuth.mockResolvedValue({ status: 'authorized' });
    mockCsrf.mockResolvedValue({ valid: true });
    mockCreateClient.mockResolvedValue({});
    mockList.mockResolvedValue({ data: [member], error: null });
    mockUpsert.mockResolvedValue({ data: [member], error: null });
    mockRevoke.mockResolvedValue({
      data: [{ ...member, status: 'revoked' }],
      error: null,
    });
  });

  it('denies unauthenticated callers before client, csrf, or RPC work', async () => {
    mockAccessAuth.mockResolvedValue({ status: 'unauthenticated' });

    const response = await POST(
      request('POST', {
        confirmed: true,
        email: 'owner@example.test',
        reason: 'Operational access',
        role: 'owner',
      })
    );

    expect(response.status).toBe(401);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockCsrf).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('checks csrf after authorization and before parsing or mutation', async () => {
    mockCsrf.mockResolvedValue({ valid: false });

    const response = await DELETE(
      request('DELETE', {
        confirmed: true,
        email: 'owner@example.test',
        reason: 'No longer needed',
      })
    );

    expect(response.status).toBe(403);
    expect(mockCreateClient).toHaveBeenCalledOnce();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('lists the no-store safe membership DTO only for roles.manage', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mockList).toHaveBeenCalledWith({}, 100, 0);
  });

  it('requires confirmed, bounded input before an upsert RPC', async () => {
    const invalidResponse = await POST(
      request('POST', {
        confirmed: false,
        email: 'owner@example.test',
        reason: '',
        role: 'owner',
      })
    );
    expect(invalidResponse.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();

    const response = await POST(
      request('POST', {
        confirmed: true,
        email: 'OWNER@EXAMPLE.TEST',
        reactivate: false,
        reason: 'Operational access',
        role: 'owner',
      })
    );
    expect(response.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ email: 'owner@example.test', confirmed: true })
    );
  });
});
