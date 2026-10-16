import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  getUserAccess: mocks.access,
  hasPermission: mocks.permission,
}));
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
describe('paid checkout shipping recovery confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeRecoveryMocks(mocks);
  });
  it('requires separate explicit confirmation, with no carrier call', async () => {
    mocks.rpc.mockResolvedValue({
      data: { quoteId, confirmed: true },
      error: null,
    });
    const response = await request({
      action: 'confirm',
      previewId: quoteId,
      confirmDestination: true,
    });
    expect(await response.json()).toEqual({ quoteId, confirmed: true });
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'confirm_customer_checkout_shipping_recovery',
      {
        p_order_id: orderId,
        p_preview_id: quoteId,
        p_confirm_destination: true,
      }
    );
  });
  it('refuses missing confirmation', async () => {
    expect(
      (
        await request({
          action: 'confirm',
          previewId: quoteId,
          confirmDestination: false,
        })
      ).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps concurrent changes to a retryable conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'shipping_recovery_stale' },
    });
    const response = await request({
      action: 'confirm',
      previewId: quoteId,
      confirmDestination: true,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SHIPPING_RECOVERY_STALE');
  });
});
