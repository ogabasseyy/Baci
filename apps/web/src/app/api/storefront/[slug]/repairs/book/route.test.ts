import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  resolveRepairsCatalogMerchant: vi.fn(),
  createRepairBooking: vi.fn(),
  notifyRepairBooking: vi.fn(),
}));

vi.mock('@/lib/repairs/repairs-catalog-access', () => ({
  resolveRepairsCatalogMerchant: mocks.resolveRepairsCatalogMerchant,
}));

vi.mock('@/lib/repairs/create-repair-core', () => ({
  createRepairBooking: mocks.createRepairBooking,
}));

vi.mock('@/lib/repair-notifications', () => ({
  notifyRepairBooking: mocks.notifyRepairBooking,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const quoteId = '223e4567-e89b-12d3-a456-426614174999';
const deviceId = '323e4567-e89b-12d3-a456-426614174888';

const validBody = {
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone',
  deviceModel: 'iPhone 15',
  issueDescription: 'The screen is cracked and the battery drains quickly.',
  serviceType: 'dropoff',
};

function buildRequest(body: unknown): NextRequest {
  return {
    json: () => {
      if (body === 'INVALID_JSON') {
        return Promise.reject(new Error('Unexpected token'));
      }
      return Promise.resolve(body);
    },
  } as unknown as NextRequest;
}

const params = (slug: string) => Promise.resolve({ slug });

describe('POST /api/storefront/[slug]/repairs/book', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRepairsCatalogMerchant.mockResolvedValue({
      merchantId,
      enabled: true,
    });
    mocks.notifyRepairBooking.mockResolvedValue(undefined);
  });

  it('returns 400 for an invalid store slug', async () => {
    const response = await POST(buildRequest(validBody), {
      params: params('BAD SLUG'),
    });

    expect(response.status).toBe(400);
    expect(mocks.resolveRepairsCatalogMerchant).not.toHaveBeenCalled();
  });

  it('returns 400 for an unparsable JSON body', async () => {
    const response = await POST(buildRequest('INVALID_JSON'), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(400);
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
  });

  it('returns 404 when the merchant does not exist', async () => {
    mocks.resolveRepairsCatalogMerchant.mockResolvedValueOnce(null);

    const response = await POST(buildRequest(validBody), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(404);
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
  });

  it('returns 404 when the repairs catalogue is disabled', async () => {
    mocks.resolveRepairsCatalogMerchant.mockResolvedValueOnce({
      merchantId,
      enabled: false,
    });

    const response = await POST(buildRequest(validBody), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(404);
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
  });

  it('returns 400 with field errors for an invalid body without calling the booking core', async () => {
    const response = await POST(
      buildRequest({ ...validBody, customerEmail: 'not-an-email' }),
      { params: params('ogabassey') }
    );
    const responseBody = (await response.json()) as {
      error: string;
      details?: { fieldErrors: Record<string, string[]> };
    };

    expect(response.status).toBe(400);
    expect(responseBody.details?.fieldErrors.customerEmail).toBeDefined();
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
  });

  it('returns 409 when pickup is requested because mobile must pay before booking', async () => {
    const response = await POST(
      buildRequest({
        ...validBody,
        pickupAddress: '12 Station Road, Osogbo, Osun, Nigeria',
        serviceType: 'pickup',
      }),
      { params: params('ogabassey') }
    );
    const responseBody = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(responseBody.error).toBe(
      'Courier pickup must be paid before booking.'
    );
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
  });

  it('returns 429 when the booking core reports rate_limited', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: false,
      error: 'Too many repair requests. Please try again in a minute.',
      code: 'rate_limited',
    });

    const response = await POST(buildRequest(validBody), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(429);
    expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
  });

  it('returns 409 when the booking core reports an unavailable quote/device', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: false,
      error: 'That repair option is no longer available. Please pick another.',
      code: 'unavailable',
    });

    const response = await POST(buildRequest({ ...validBody, quoteId }), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(409);
  });

  it('returns 500 when the booking core reports an unknown failure', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: false,
      error: 'Failed to submit repair request. Please try again.',
      code: 'unknown',
    });

    const response = await POST(buildRequest(validBody), {
      params: params('ogabassey'),
    });

    expect(response.status).toBe(500);
  });

  it('books through the shared core, notifies, and returns the ticket on success', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: true,
      id: 'repair-1',
      ticketNumber: 42,
    });

    const response = await POST(
      buildRequest({
        ...validBody,
        deviceId,
        quoteId,
        pickupAddress: undefined,
      }),
      { params: params('ogabassey') }
    );
    const responseBody = (await response.json()) as {
      id: string;
      ticketNumber: number;
    };

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ id: 'repair-1', ticketNumber: 42 });
    expect(mocks.createRepairBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'ada@example.com',
        deviceId,
        quoteId,
      }),
      merchantId
    );
    expect(mocks.notifyRepairBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'ada@example.com',
        customerName: 'Ada Lovelace',
        deviceModel: 'iPhone 15',
        deviceType: 'Smartphone',
        merchantId,
        quoteId,
        repairId: 'repair-1',
        serviceType: 'dropoff',
        ticketNumber: 42,
      })
    );
  });

  it('returns 500 when the merchant lookup throws', async () => {
    mocks.resolveRepairsCatalogMerchant.mockRejectedValueOnce(
      new Error('boom')
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(buildRequest(validBody), {
        params: params('ogabassey'),
      });

      expect(response.status).toBe(500);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
