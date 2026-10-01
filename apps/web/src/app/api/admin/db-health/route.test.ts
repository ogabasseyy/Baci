import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc: mockRpc })),
}));

import { GET } from './route';

const healthPayload = {
  checkedAt: '2026-08-05T15:00:00.000Z',
  health: [
    {
      check_name: 'Database query',
      details: { server_time: '2026-08-05T15:00:00.000Z' },
      message: 'PostgreSQL responded.',
      status: 'healthy',
    },
  ],
  indexRecommendations: [],
  missingIndexes: [],
};

const workerHealthPayload = {
  check_name: 'Scheduled notification worker',
  details: { probe: 'worker_heartbeat_and_delivery_state' },
  message: 'Scheduled notification worker is active.',
  status: 'healthy',
};

describe('GET /api/admin/db-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['operations.read'], role: 'owner' },
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === 'get_scheduled_notification_worker_health_v1'
            ? workerHealthPayload
            : healthPayload,
        error: null,
      })
    );
  });

  it('authenticates and authorizes before reading database health', async () => {
    const response = await GET();

    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'operations.read'
    );
    expect(mockRpc).toHaveBeenCalledWith('get_admin_system_health_v1');
    expect(mockRpc).toHaveBeenCalledWith(
      'get_scheduled_notification_worker_health_v1'
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each([
    ['unauthenticated', 401, 'Unauthorized'],
    ['forbidden', 403, 'Forbidden'],
  ] as const)('returns the correct boundary for %s callers', async (status, expectedStatus, expectedError) => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({ status });

    const response = await GET();

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ error: expectedError });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fails visibly when the database check errors', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '42501',
        message: 'provider diagnostic must not reach application logs',
      },
    });

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to check database health',
    });
    expect(errorLog).toHaveBeenCalledWith('[Admin system health] RPC failed', {
      code: '42501',
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'provider diagnostic'
    );
    errorLog.mockRestore();
  });

  it('rejects malformed data instead of returning false healthy empties', async () => {
    mockRpc.mockResolvedValueOnce({ data: { health: [] }, error: null });

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid database health response',
    });
  });

  it('adds a critical health check when the notification-worker probe fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc
      .mockResolvedValueOnce({ data: healthPayload, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: '42883',
          message: 'worker implementation detail must not reach logs',
        },
      });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      health: expect.arrayContaining([
        expect.objectContaining({
          check_name: 'Scheduled notification worker',
          status: 'critical',
        }),
      ]),
    });
    expect(errorLog).toHaveBeenCalledWith(
      '[Admin system health] Notification worker probe failed',
      { code: '42883' }
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'worker implementation detail'
    );
    errorLog.mockRestore();
  });

  it('adds a critical health check when the notification-worker probe is malformed', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc
      .mockResolvedValueOnce({ data: healthPayload, error: null })
      .mockResolvedValueOnce({ data: { status: 'healthy' }, error: null });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      health: expect.arrayContaining([
        expect.objectContaining({
          check_name: 'Scheduled notification worker',
          status: 'critical',
        }),
      ]),
    });
    expect(errorLog).toHaveBeenCalledWith(
      '[Admin system health] Notification worker probe returned invalid response'
    );
    errorLog.mockRestore();
  });
});
