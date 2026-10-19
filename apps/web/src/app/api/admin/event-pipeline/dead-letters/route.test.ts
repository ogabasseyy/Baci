import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: mocks.auth,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { GET } from './route';

describe('GET /api/admin/event-pipeline/dead-letters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates before opening operator queries', async () => {
    mocks.auth.mockResolvedValue({ status: 'unauthenticated' });
    const response = await GET(
      new NextRequest('http://localhost/api/admin/event-pipeline/dead-letters')
    );

    expect(response.status).toBe(401);
  });

  it('rejects invalid operator filters', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    const response = await GET(
      new NextRequest(
        'http://localhost/api/admin/event-pipeline/dead-letters?limit=101'
      )
    );

    expect(response.status).toBe(400);
  });

  it('uses the authenticated admin RPC surface for safe summaries', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    const rpc = vi.fn((name: string) => {
      if (name === 'get_event_pipeline_operations_admin_v3') {
        return Promise.resolve({
          data: {
            deliveries: [],
            heartbeats: [],
            queue: null,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { count: 0, items: [] }, error: null });
    });
    mocks.createClient.mockResolvedValue({ rpc });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/event-pipeline/dead-letters')
    );

    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith('operations.read');
    expect(mocks.createClient).toHaveBeenCalledWith('event-pipeline');
    expect(rpc).toHaveBeenCalledWith(
      'list_event_pipeline_ingress_failures_admin_v3',
      expect.any(Object)
    );
  });

  it('returns only the explicit redacted incident DTO fields', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn((name: string) => {
        if (name === 'get_event_pipeline_operations_admin_v3') {
          return Promise.resolve({
            data: { deliveries: [], heartbeats: [], queue: null },
            error: null,
          });
        }
        if (name === 'list_event_pipeline_ingress_failures_admin_v3') {
          return Promise.resolve({
            data: {
              count: 1,
              items: [
                {
                  event_name: 'order.paid',
                  failure_code: 'invalid_payload',
                  first_failed_at: '2026-08-05T10:00:00.000Z',
                  id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
                  last_failed_at: '2026-08-05T10:01:00.000Z',
                  replay_count: 0,
                },
              ],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { count: 0, items: [] }, error: null });
      }),
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/event-pipeline/dead-letters')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ingress[0]).toEqual({
      event_name: 'order.paid',
      failure_code: 'invalid_payload',
      first_failed_at: '2026-08-05T10:00:00.000Z',
      id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
      last_failed_at: '2026-08-05T10:01:00.000Z',
      replay_count: 0,
    });
    expect(body.ingress[0]).not.toHaveProperty('failure_message');
  });

  it('fails closed without returning a hostile failure message', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn((name: string) => {
        if (name === 'get_event_pipeline_operations_admin_v3') {
          return Promise.resolve({
            data: { deliveries: [], heartbeats: [], queue: null },
            error: null,
          });
        }
        if (name === 'list_event_pipeline_ingress_failures_admin_v3') {
          return Promise.resolve({
            data: {
              count: 1,
              items: [
                {
                  event_name: 'order.paid',
                  failure_code: 'invalid_payload',
                  failure_message:
                    'customer@example.invalid: malformed provider response',
                  first_failed_at: '2026-08-05T10:00:00.000Z',
                  id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
                  last_failed_at: '2026-08-05T10:01:00.000Z',
                  replay_count: 0,
                },
              ],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { count: 0, items: [] }, error: null });
      }),
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/event-pipeline/dead-letters')
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load event pipeline failures' });
    expect(JSON.stringify(body)).not.toContain('customer@example.invalid');
  });

  it('returns 500 when an operator RPC fails', async () => {
    mocks.auth.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'operator query failed' },
      }),
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/event-pipeline/dead-letters')
    );

    expect(response.status).toBe(500);
  });
});
