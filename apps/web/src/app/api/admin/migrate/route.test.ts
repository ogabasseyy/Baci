import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mocks.auth(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mocks.csrf(...args),
}));

import { GET, POST } from './route';

function request() {
  return new Request('http://localhost/api/admin/migrate', {
    method: 'POST',
  }) as NextRequest;
}

describe('/api/admin/migrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      context: { permissions: ['operations.read'], role: 'operations' },
      status: 'authenticated',
      user: { email: null, id: 'operator-1' },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
  });

  it('authenticates before CSRF or database access', async () => {
    mocks.auth.mockResolvedValueOnce({ status: 'unauthenticated' });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.auth).toHaveBeenCalledWith('operations.read');
    expect(mocks.csrf).not.toHaveBeenCalled();
  });

  it('protects the informational GET endpoint', async () => {
    mocks.auth.mockResolvedValueOnce({ status: 'forbidden' });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it('retires the stale probe instead of querying or applying schema changes', async () => {
    const response = await POST(request());

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: 'migration_probe_retired',
      error:
        'This legacy schema probe is retired. Verify database changes through the controlled migration replay pipeline.',
    });
  });

  it('returns the same standard retirement response for GET', async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: 'migration_probe_retired',
      error:
        'This legacy schema probe is retired. Verify database changes through the controlled migration replay pipeline.',
    });
  });
});
