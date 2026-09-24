import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  pack: vi.fn(),
  providers: vi.fn(),
  user: vi.fn(),
  client: vi.fn(),
  orderItems: vi.fn(),
  cancel: vi.fn(),
  syncStatus: vi.fn(),
}));
vi.mock('@/lib/jumia/fulfillment', () => ({
  packOrderV2: m.pack,
  readyToShip: vi.fn(),
  printLabels: vi.fn(),
  cancelItems: m.cancel,
}));
vi.mock('@/lib/jumia/orders', () => ({
  getOrderItems: m.orderItems,
  getShipmentProviders: m.providers,
}));
vi.mock('./sync-jumia-action-status', () => ({
  updateJumiaActionOrderStatus: m.syncStatus,
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: { forIntegration: m.client },
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: m.user }, from: vi.fn() })),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(async () => ({ merchantId: 'M' })),
  toUserAccess: vi.fn(() => ({})),
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: vi.fn(() => true) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
describe('Jumia actions pack validation', () => {
  it('rejects a pack before the pack call when tracking code is required', async () => {
    m.user.mockResolvedValue({ data: { user: { id: 'U' } } });
    m.client.mockResolvedValue({});
    m.providers.mockResolvedValue({
      orderItems: [
        {
          id: 'ITEM-1',
          shipmentProviders: [{ id: 'SP-1', trackingCodeRequired: true }],
        },
      ],
    });
    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          action: 'pack',
          integrationId: '00000000-0000-0000-0000-000000000001',
          orderId: 'ORDER-1',
          itemIds: ['ITEM-1'],
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(m.pack).not.toHaveBeenCalled();
  });
});

describe('Jumia actions all-items detection', () => {
  const INTEGRATION_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function postCancel(itemIds: string[]) {
    m.user.mockResolvedValue({ data: { user: { id: 'U' } } });
    m.client.mockResolvedValue({});
    m.orderItems.mockResolvedValue({
      items: [{ id: 'ITEM-1' }, { id: 'ITEM-2' }],
    });
    m.cancel.mockResolvedValue({
      success: { total: itemIds.length },
      error: { total: 0 },
    });
    m.syncStatus.mockResolvedValue({});
    const { POST } = await import('./route');
    return POST(
      new NextRequest('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          action: 'cancel',
          integrationId: INTEGRATION_ID,
          orderId: 'ORDER-1',
          itemIds,
        }),
      })
    );
  }

  it('syncs order status when explicit IDs cover every provider item', async () => {
    const response = await postCancel(['ITEM-1', 'ITEM-2']);
    expect(response.status).toBe(200);
    expect(m.syncStatus).toHaveBeenCalledWith(
      expect.anything(),
      'ORDER-1',
      'M',
      'Cancelled'
    );
  });

  it('skips order status sync when explicit IDs are a subset', async () => {
    const response = await postCancel(['ITEM-1']);
    expect(response.status).toBe(200);
    expect(m.syncStatus).not.toHaveBeenCalled();
  });
});
