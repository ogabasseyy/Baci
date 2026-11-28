import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrfProtection = vi.fn();
const mockCreateServiceClient = vi.fn();

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

import { POST } from './route';

describe('POST /api/edge-config/sync verifying_routing inbound-only mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    process.env.EDGE_CONFIG_SYNC_SECRET = 'sync-secret';
    process.env.VERCEL_API_TOKEN = 'vercel-tok';
    process.env.EDGE_CONFIG_ID = 'ecfg_test123';
  });

  it('publishes only inbound domain_* → slug for verifying_routing without overwriting existing slug_* → primaryDomain', async () => {
    mockCreateServiceClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  domain: 'old-primary.example.com',
                  is_primary: true,
                  domain_type: 'custom',
                  merchants: { slug: 'pilot-merchant' },
                },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                hostname: 'new-candidate.example.com',
                merchants: { slug: 'pilot-merchant' },
              },
            ],
            error: null,
          }),
        };
      }),
    });

    const patchBodies: Array<{
      items: Array<{ key: string; value?: string; operation: string }>;
    }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        patchBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      });

    const res = await POST(
      new Request('https://usebaci.com/api/edge-config/sync', {
        method: 'POST',
        headers: { authorization: 'Bearer sync-secret' },
      })
    );

    expect(res.status).toBe(200);
    expect(patchBodies).toHaveLength(1);
    const items = patchBodies[0].items;
    expect(items).toContainEqual({
      operation: 'upsert',
      key: 'domain_new-candidate_example_com',
      value: 'pilot-merchant',
    });
    expect(items).toContainEqual({
      operation: 'upsert',
      key: 'slug_pilot-merchant',
      value: 'old-primary.example.com',
    });
    fetchSpy.mockRestore();
  });
});
