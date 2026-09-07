import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  rate: vi.fn(),
  merchant: vi.fn(),
  receiver: vi.fn(),
  quote: vi.fn(),
  pay: vi.fn(),
}));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.rate,
}));
vi.mock('@/lib/repairs/repairs-catalog-access', () => ({
  resolveRepairsCatalogMerchant: mocks.merchant,
}));
vi.mock('@/lib/repairs/repair-center-address', () => ({
  getRepairCenterAddress: mocks.receiver,
}));
vi.mock('@/lib/repairs/quote-repair-pickup', () => ({
  quoteRepairPickup: mocks.quote,
}));
vi.mock('@/lib/repairs/start-mobile-repair-pickup-payment', () => ({
  startMobileRepairPickupPayment: mocks.pay,
}));

const data = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone',
  deviceModel: 'iPhone 13',
  issueDescription: 'The screen is broken',
  serviceType: 'pickup',
  pickupAddress: '10 Test Street, Osogbo, Osun',
};
const call = (body: unknown) =>
  POST(
    new NextRequest('https://example.com/api/storefront/test/repairs/pickup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: 'test' }) }
  );

describe('mobile repair pickup', () => {
  it('rejects separator-padded phones before merchant or carrier access', async () => {
    const response = await call({
      action: 'quote',
      data: { ...data, customerPhone: '0803------' },
    });
    expect(response.status).toBe(400);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rate.mockResolvedValue(true);
    mocks.merchant.mockResolvedValue({
      enabled: true,
      merchantId: 'trusted-merchant',
    });
    mocks.receiver.mockResolvedValue({
      address: 'Private address',
      email: 'private@example.com',
    });
    mocks.quote.mockResolvedValue({
      quote: { price: 3000, currency: 'NGN', receiver: 'private' },
    });
  });
  it('returns only the price and currency without creating a booking', async () => {
    const response = await call({ action: 'quote', data });
    expect(await response.json()).toEqual({ price: 3000, currency: 'NGN' });
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('binds payment to the resolved merchant and preserves resumable failures', async () => {
    mocks.pay.mockResolvedValue({
      success: false,
      code: 'payment_initialization_failed',
      error: 'Retry',
      resumeToken: 'resume',
    });
    const response = await call({
      action: 'pay',
      requestId: '14bf2192-16de-442b-bf75-700f4ff2aaca',
      data,
      expectedPickupFee: 3000,
      merchantId: 'attacker',
      resumeToken: 'original',
    });
    expect(mocks.pay).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'trusted-merchant',
        merchantIdentifier: 'test',
        resumeToken: 'original',
      })
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({ resumeToken: 'resume' })
    );
  });
  it('returns the initialized payment and ticket without booking the carrier', async () => {
    const result = {
      success: true,
      id: 'repair',
      ticketNumber: 123,
      resumeToken: 'resume',
      payment: {
        amount: 3000,
        authorizationUrl: 'https://checkout.paystack.com/test',
        reference: 'ref',
      },
    };
    mocks.pay.mockResolvedValue(result);
    const response = await call({
      action: 'pay',
      requestId: '14bf2192-16de-442b-bf75-700f4ff2aaca',
      data,
      expectedPickupFee: 3000,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.pay).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid bodies before merchant lookup', async () => {
    expect((await call({ action: 'quote', data: {} })).status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
  it('rejects unavailable merchants without accessing the private receiver', async () => {
    mocks.merchant.mockResolvedValue({ enabled: false });
    expect((await call({ action: 'quote', data })).status).toBe(404);
    expect(mocks.receiver).not.toHaveBeenCalled();
  });
  it('offers drop-off when there is no carrier quote', async () => {
    mocks.quote.mockResolvedValue({ quote: null });
    const response = await call({ action: 'quote', data });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('drop-off');
  });
  it('bounds excessive requests before any merchant access', async () => {
    mocks.rate.mockResolvedValue(false);
    expect((await call({ action: 'quote', data })).status).toBe(429);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
});
