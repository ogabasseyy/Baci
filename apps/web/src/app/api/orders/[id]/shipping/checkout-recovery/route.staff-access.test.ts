import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserAccess } from '@/lib/api-permissions';
import {
  recoveryMerchantId as merchantId,
  recoveryOrderId as orderId,
  primeRecoveryMocks,
  recoveryQuoteId as quoteId,
  postRecovery as request,
} from './route.test-support';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  access: vi.fn(),
  permission: vi.fn(),
  rpc: vi.fn(),
  quotes: vi.fn(),
  sender: vi.fn(),
}));
// Real permission evaluation: owners pass, staff need orders.fulfill and
// orders.edit (recovery rewrites the paid order; booking needs orders.edit).
vi.mock('@/lib/api-auth', async () => {
  const permissions = await vi.importActual<
    typeof import('@/lib/api-permissions')
  >('@/lib/api-permissions');
  return {
    authenticateApiRequest: mocks.auth,
    getUserAccess: mocks.access,
    hasPermission: permissions.hasPermission,
  };
});
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.sender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class {
    getProviderQuotes = mocks.quotes;
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

function staff(permissions: UserAccess['permissions']): UserAccess {
  return {
    merchantId,
    role: 'fulfillment',
    isOwner: false,
    isStaff: true,
    permissions,
  };
}

describe('checkout recovery staff access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeRecoveryMocks(mocks);
  });

  it('lets the owner preview a recovery quote', async () => {
    mocks.access.mockResolvedValue({
      merchantId,
      role: 'owner',
      isOwner: true,
      isStaff: false,
      permissions: {},
    } satisfies UserAccess);
    const response = await request();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      previewId: quoteId,
    });
  });

  it('lets staff granted orders.fulfill and orders.edit preview a recovery quote', async () => {
    mocks.access.mockResolvedValue(
      staff({ orders: { view: true, fulfill: true, edit: true } })
    );
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.quotes).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'prepare_customer_checkout_shipping_recovery',
      expect.objectContaining({ p_order_id: orderId })
    );
  });

  it('lets orders.fulfill + orders.edit staff confirm their own preview', async () => {
    mocks.access.mockResolvedValue(
      staff({ orders: { fulfill: true, edit: true } })
    );
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'confirm_customer_checkout_shipping_recovery'
        ? { data: { quoteId, confirmed: true }, error: null }
        : { data: null, error: { message: 'unexpected rpc' } }
    );
    const response = await request({
      action: 'confirm',
      previewId: quoteId,
      confirmDestination: true,
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'confirm_customer_checkout_shipping_recovery',
      {
        p_order_id: orderId,
        p_preview_id: quoteId,
        p_confirm_destination: true,
      }
    );
  });

  it.each([
    ['orders.edit only', { orders: { view: true, edit: true } }],
    ['orders.fulfill only', { orders: { view: true, fulfill: true } }],
    ['explicit fulfill denial', { orders: { fulfill: false, edit: true } }],
    ['no orders grant', { products: { view: true } }],
  ])('rejects staff with %s before any RPC or quote', async (_label, grants) => {
    mocks.access.mockResolvedValue(staff(grants));
    const response = await request();
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
});
