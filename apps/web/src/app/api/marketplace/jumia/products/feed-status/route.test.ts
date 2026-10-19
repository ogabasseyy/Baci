import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  auth: vi.fn(),
  merchant: vi.fn(),
  access: vi.fn(),
  permission: vi.fn(),
  gate: vi.fn(),
  client: vi.fn(),
  feed: vi.fn(),
  pendingMappings: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  getMerchantIdForApiUser: mocks.merchant,
  getUserAccess: mocks.access,
  hasPermission: mocks.permission,
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: mocks.gate,
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: { forIntegration: mocks.client },
  JumiaApiError: class JumiaApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  jumiaErrorResponse: vi.fn(() =>
    Response.json({ error: 'Jumia error' }, { status: 502 })
  ),
}));
vi.mock('@/lib/jumia/feeds', () => ({ getFeedStatus: mocks.feed }));
vi.mock('./load-pending-feed-mappings', () => ({
  loadPendingFeedMappings: mocks.pendingMappings,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { POST } from './route';

function request() {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/products/feed-status?integrationId=00000000-0000-4000-8000-000000000099',
    { method: 'POST' }
  );
}

function mappingUpdate(update: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    update(...args);
    const resolved = Promise.resolve({
      data: { id: 'mapping-1' },
      error: null,
    });
    const builder = Object.assign(resolved, {
      eq: vi.fn(),
      in: vi.fn(),
      is: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(() => resolved),
    });
    builder.eq.mockReturnValue(builder);
    builder.in.mockReturnValue(builder);
    builder.is.mockReturnValue(builder);
    builder.select.mockReturnValue(builder);
    return builder;
  };
}

describe('Jumia feed status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.auth.mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: { from: mocks.from },
    });
    mocks.merchant.mockResolvedValue('merchant-1');
    mocks.access.mockResolvedValue({
      merchantId: 'merchant-1',
      role: 'owner',
      isOwner: true,
      isStaff: false,
      permissions: {},
    });
    mocks.permission.mockReturnValue(true);
    mocks.gate.mockResolvedValue(null);
    mocks.client.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'default',
    });
    mocks.pendingMappings.mockResolvedValue({ mappings: [], error: null });
  });

  it('rejects malformed integration ids before loading the client', async () => {
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/feed-status?integrationId=bad',
        { method: 'POST' }
      )
    );
    expect(response.status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.auth.mockResolvedValueOnce({
      user: null,
      error: new Error('Unauthorized'),
      supabase: null,
    });

    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('returns 500 when pending mapping lookup fails', async () => {
    mocks.pendingMappings.mockResolvedValue({
      mappings: [],
      error: { message: 'database unavailable' },
    });

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Failed to load pending product feeds',
    });
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it('surfaces ambiguous submissions for explicit manual resolution', async () => {
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-ambiguous',
          last_feed_id: null,
          jumia_seller_sku: 'SKU-UNKNOWN',
          last_synced_at: '2026-08-25T02:00:00Z',
          sync_error: 'ambiguous_submission_requires_manual_resolution',
        },
      ],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      checked: 0,
      pending: 1,
      manualResolutionRequired: [
        {
          mappingId: 'mapping-ambiguous',
          sellerSku: 'SKU-UNKNOWN',
        },
      ],
    });
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it('surfaces rejected-feed marking failures instead of reporting success', async () => {
    const update = vi.fn();
    const failedUpdate = (...args: unknown[]) => {
      update(...args);
      const resolved = Promise.resolve({ error: { message: 'write failed' } });
      const builder = Object.assign(resolved, { eq: vi.fn() });
      builder.eq.mockReturnValue(builder);
      return builder;
    };
    mocks.from.mockReturnValue({
      update: failedUpdate,
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: 'SKU-1',
          last_synced_at: null,
        },
      ],
      error: null,
    });
    mocks.feed.mockResolvedValue({
      feedSid: 'feed-1',
      status: 'FAILED',
      feedType: 'ProductCreate',
      feedSource: 'API',
      total: 1,
      completed: 0,
      failed: 1,
      createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
      feedItems: [],
    });

    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(update).toHaveBeenCalled();
  });

  it('reconciles accepted feed items into synced mappings', async () => {
    const update = vi.fn();
    mocks.from.mockReturnValue({
      update: mappingUpdate(update),
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: 'SKU-1',
          last_synced_at: null,
        },
      ],
      error: null,
    });
    mocks.feed.mockResolvedValue({
      feedSid: 'feed-1',
      status: 'COMPLETED',
      feedType: 'ProductCreate',
      feedSource: 'API',
      total: 1,
      completed: 1,
      failed: 0,
      createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
      feedItems: [
        {
          status: 'SUCCESS',
          productSid: 'JUMIA-1',
          sellerSKU: 'SKU-1',
          createdAt: '2026-08-12T10:00:00Z',
          updatedAt: '2026-08-12T10:00:00Z',
        },
      ],
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).updated).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'synced',
        jumia_product_id: 'JUMIA-1',
      })
    );
  });

  it('keeps an accepted item without a product id pending for manual resolution', async () => {
    const update = vi.fn();
    mocks.from.mockReturnValue({
      update: mappingUpdate(update),
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: 'SKU-1',
          last_synced_at: null,
        },
      ],
      error: null,
    });
    mocks.feed.mockResolvedValue({
      feedSid: 'feed-1',
      status: 'COMPLETED',
      feedType: 'ProductCreate',
      feedSource: 'API',
      total: 1,
      completed: 1,
      failed: 0,
      createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
      feedItems: [
        {
          status: 'SUCCESS',
          sellerSKU: 'SKU-1',
          createdAt: '2026-08-12T10:00:00Z',
          updatedAt: '2026-08-12T10:00:00Z',
        },
      ],
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 0,
      failed: 0,
      pending: 1,
      manualResolutionRequired: [
        { mappingId: 'mapping-1', sellerSku: 'SKU-1' },
      ],
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'pending',
        sync_error: 'ambiguous_submission_requires_manual_resolution',
        last_feed_id: null,
      })
    );
  });

  it('continues reconciling newer feeds after a feed lookup fails', async () => {
    const update = vi.fn();
    mocks.from.mockReturnValue({
      update: mappingUpdate(update),
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-missing',
          last_feed_id: 'feed-missing',
          jumia_seller_sku: 'SKU-MISSING',
          last_synced_at: '2026-08-01T00:00:00Z',
        },
        {
          id: 'mapping-current',
          last_feed_id: 'feed-current',
          jumia_seller_sku: 'SKU-CURRENT',
          last_synced_at: '2026-08-02T00:00:00Z',
        },
      ],
      error: null,
    });
    mocks.feed
      .mockRejectedValueOnce(
        new (await import('@/lib/jumia/client')).JumiaApiError(404, 'gone')
      )
      .mockResolvedValueOnce({
        feedSid: 'feed-current',
        status: 'COMPLETED',
        feedType: 'ProductCreate',
        feedSource: 'API',
        total: 1,
        completed: 1,
        failed: 0,
        createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
        feedItems: [
          {
            status: 'SUCCESS',
            productSid: 'JUMIA-CURRENT',
            sellerSKU: 'SKU-CURRENT',
            createdAt: '2026-08-12T10:00:00Z',
            updatedAt: '2026-08-12T10:00:00Z',
          },
        ],
      });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.feed).toHaveBeenCalledTimes(2);
    expect(body.feeds).toEqual([
      expect.objectContaining({ feedId: 'feed-missing', status: 'NOT_FOUND' }),
      expect.objectContaining({ feedId: 'feed-current', status: 'COMPLETED' }),
    ]);
    expect(body.updated).toBe(1);
    expect(body.failed).toBe(0);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'pending',
        sync_error: 'ambiguous_submission_requires_manual_resolution',
        last_feed_id: null,
      })
    );
    expect(body.manualResolutionRequired).toEqual([
      { mappingId: 'mapping-missing', sellerSku: 'SKU-MISSING' },
    ]);
  });

  it('returns 500 when an individual feed mapping update fails', async () => {
    const update = vi.fn();
    mocks.from.mockReturnValue({
      update: (...args: unknown[]) => {
        update(...args);
        const resolved = Promise.resolve({
          error: { message: 'write failed' },
        });
        const builder = Object.assign(resolved, { eq: vi.fn() });
        builder.eq.mockReturnValue(builder);
        return builder;
      },
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: 'SKU-1',
          last_synced_at: null,
        },
      ],
      error: null,
    });
    mocks.feed.mockResolvedValue({
      feedSid: 'feed-1',
      status: 'COMPLETED',
      feedType: 'ProductCreate',
      feedSource: 'API',
      total: 1,
      completed: 1,
      failed: 0,
      createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
      feedItems: [
        {
          status: 'SUCCESS',
          productSid: 'JUMIA-1',
          sellerSKU: 'SKU-1',
          createdAt: '2026-08-12T10:00:00Z',
          updatedAt: '2026-08-12T10:00:00Z',
        },
      ],
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to reconcile Jumia feed item',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ sync_status: 'synced' })
    );
  });

  it('does not reuse a null-SKU fallback when multiple feed items exist', async () => {
    const update = vi.fn();
    mocks.from.mockReturnValue({
      update: mappingUpdate(update),
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: null,
          last_synced_at: null,
        },
        {
          id: 'mapping-2',
          last_feed_id: 'feed-1',
          jumia_seller_sku: null,
          last_synced_at: null,
        },
      ],
      error: null,
    });
    mocks.feed.mockResolvedValue({
      feedSid: 'feed-1',
      status: 'COMPLETED',
      feedType: 'ProductCreate',
      feedSource: 'API',
      total: 2,
      completed: 0,
      failed: 0,
      createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
      feedItems: [
        {
          status: 'SUCCESS',
          productSid: 'JUMIA-1',
          sellerSKU: 'SKU-1',
          createdAt: '2026-08-12T10:00:00Z',
          updatedAt: '2026-08-12T10:00:00Z',
        },
        {
          status: 'SUCCESS',
          productSid: 'JUMIA-2',
          sellerSKU: 'SKU-2',
          createdAt: '2026-08-12T10:00:00Z',
          updatedAt: '2026-08-12T10:00:00Z',
        },
      ],
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 0,
      failed: 0,
      pending: 2,
      manualResolutionRequired: [
        { mappingId: 'mapping-1', sellerSku: null },
        { mappingId: 'mapping-2', sellerSku: null },
      ],
    });
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ sync_status: 'synced' })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'pending',
        sync_error: 'ambiguous_submission_requires_manual_resolution',
        last_feed_id: null,
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ last_synced_at: expect.any(String) })
    );
  });

  it('returns 500 when the feed reconciliation cursor cannot advance', async () => {
    const update = vi.fn();
    let cursorUpdateCount = 0;
    mocks.from.mockReturnValue({
      update: (...args: unknown[]) => {
        update(...args);
        cursorUpdateCount += 1;
        const resolved = Promise.resolve({
          error: cursorUpdateCount === 2 ? { message: 'write failed' } : null,
        });
        const builder = Object.assign(resolved, { eq: vi.fn() });
        builder.eq.mockReturnValue(builder);
        return builder;
      },
    });
    mocks.pendingMappings.mockResolvedValue({
      mappings: [
        {
          id: 'mapping-1',
          last_feed_id: 'feed-1',
          jumia_seller_sku: 'SKU-1',
          last_synced_at: null,
        },
      ],
      error: null,
    });
    mocks.feed.mockResolvedValue({
      feedSid: 'feed-1',
      status: 'COMPLETED',
      feedType: 'ProductCreate',
      feedSource: 'API',
      total: 1,
      completed: 1,
      failed: 0,
      createdBy: { sid: 'sid', name: 'API', email: 'api@example.com' },
      feedItems: [
        {
          status: 'SUCCESS',
          productSid: 'JUMIA-1',
          sellerSKU: 'SKU-1',
          createdAt: '2026-08-12T10:00:00Z',
          updatedAt: '2026-08-12T10:00:00Z',
        },
      ],
    });

    const response = await POST(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to advance Jumia feed reconciliation cursor',
    });
  });
});
