import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  csrf: vi.fn(),
}));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: mocks.auth,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/event-pipeline/replay', {
    body: JSON.stringify(body),
    method: 'POST',
  });
}

describe('POST /api/admin/event-pipeline/replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks platform-admin authentication before CSRF', async () => {
    mocks.auth.mockResolvedValue({ status: 'unauthenticated' });
    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
  });

  it('rejects read-only operations users before CSRF or replay work', async () => {
    mocks.auth.mockResolvedValue({ status: 'forbidden' });

    const response = await POST(request({}));

    expect(response.status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledWith('operations.manage');
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('requires CSRF before validating replay input', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mocks.csrf.mockResolvedValue({ valid: false });
    const response = await POST(request({}));

    expect(response.status).toBe(403);
  });

  it('rejects malformed replay input after authentication and CSRF', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mocks.csrf.mockResolvedValue({ valid: true });

    const response = await POST(request({ kind: 'delivery' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'invalid_input',
      error: 'Invalid input',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('replays through the authenticated platform-admin RPC', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: {
        email: 'admin@example.com',
        id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a230',
      },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    mocks.createClient.mockResolvedValue({ rpc });

    const response = await POST(
      request({
        delivery_ids: ['019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234'],
        kind: 'delivery',
        reason: 'Credential rotation verified',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledWith('event-pipeline');
    expect(mocks.auth).toHaveBeenCalledWith('operations.manage');
    expect(rpc).toHaveBeenCalledWith('replay_event_deliveries_batch_admin_v2', {
      p_delivery_ids: ['019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234'],
      p_replay_reason: 'Credential rotation verified',
    });
  });

  it('returns 500 when the replay RPC fails', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: {
        email: 'admin@example.com',
        id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a230',
      },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'replay failed' },
      }),
    });

    const response = await POST(
      request({
        failure_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
        kind: 'ingress',
        reason: 'Producer repair verified',
      })
    );

    expect(response.status).toBe(500);
  });

  it('returns a controlled 500 when filtered replay selection throws', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: {
        email: 'admin@example.com',
        id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a230',
      },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'filter failed' },
    });
    mocks.createClient.mockResolvedValue({ rpc });

    const response = await POST(
      request({
        destination: 'facebook',
        kind: 'delivery_filter',
        reason: 'Credential rotation verified',
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'replay_failed',
      error: 'Replay failed',
    });
    expect(rpc).toHaveBeenCalledWith(
      'select_event_pipeline_replay_ids_admin_v2',
      expect.objectContaining({ p_destination: 'facebook' })
    );
  });
});
