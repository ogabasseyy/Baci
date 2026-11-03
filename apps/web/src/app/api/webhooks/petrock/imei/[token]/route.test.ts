import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  createRateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { POST } from './route';

const TOKEN = 'a'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

function context(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

function adminFor(row: Record<string, unknown> | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const lookupBuilder = {
    eq: vi.fn(() => lookupBuilder),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    select: vi.fn(() => lookupBuilder),
  };
  return {
    client: {
      from: vi.fn((table: string) =>
        table === 'imei_lookups' ? lookupBuilder : { insert }
      ),
    },
    insert,
  };
}

describe('POST /api/webhooks/petrock/imei/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    });
  });

  it('captures body metadata for a valid token without trusting its values', async () => {
    const admin = adminFor({ feedback_token_hash: TOKEN_HASH, id: 'lookup-1' });
    mocks.createAdminClient.mockReturnValue(admin.client);
    const request = new Request('https://shop.example.com/feedback', {
      body: JSON.stringify({
        order_uuid: 'untrusted-order',
        status: 'success',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    const response = await POST(request, context());

    expect(response.status).toBe(200);
    expect(admin.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        body_keys: ['order_uuid', 'status'],
        lookup_id: 'lookup-1',
      })
    );
    expect(JSON.stringify(admin.insert.mock.calls)).not.toContain(
      'untrusted-order'
    );
  });

  it('returns the same accepted response for an unknown token and stores nothing', async () => {
    const admin = adminFor(null);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await POST(
      new Request('https://shop.example.com/feedback', { method: 'POST' }),
      context()
    );

    expect(response.status).toBe(200);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('enforces the route rate limit before reading the callback', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });

    const response = await POST(
      new Request('https://shop.example.com/feedback', { method: 'POST' }),
      context()
    );

    expect(response.status).toBe(429);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
