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
  const updateBuilder = {
    eq: vi.fn(() => updateBuilder),
    in: vi.fn().mockResolvedValue({ error: null }),
  };
  const lookupBuilder = {
    eq: vi.fn(() => lookupBuilder),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    select: vi.fn(() => lookupBuilder),
  };
  const orders = {
    select: lookupBuilder.select,
    update: vi.fn(() => updateBuilder),
  };
  return {
    client: {
      from: vi.fn((table: string) =>
        table === 'petrock_orders' ? orders : { insert }
      ),
    },
    insert,
    orders,
    updateBuilder,
  };
}

describe('POST /api/webhooks/petrock/remediation/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    });
  });

  it('captures metadata and nudges cron without trusting callback values', async () => {
    const admin = adminFor({ feedback_token_hash: TOKEN_HASH, id: 'order-1' });
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
    expect(admin.orders.update).toHaveBeenCalledWith(
      expect.objectContaining({ next_poll_at: expect.any(String) })
    );
    expect(admin.updateBuilder.in).toHaveBeenCalledWith(
      'status',
      expect.arrayContaining(['submission_unknown'])
    );
    expect(admin.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'feedback_callback_received',
        metadata: expect.objectContaining({
          bodyKeys: ['order_uuid', 'status'],
        }),
        order_id: 'order-1',
      })
    );
    expect(JSON.stringify(admin.insert.mock.calls)).not.toContain(
      'untrusted-order'
    );
  });

  it('accepts an unknown token without revealing or mutating order state', async () => {
    const admin = adminFor(null);
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await POST(
      new Request('https://shop.example.com/feedback', { method: 'POST' }),
      context()
    );

    expect(response.status).toBe(200);
    expect(admin.orders.update).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });
});
