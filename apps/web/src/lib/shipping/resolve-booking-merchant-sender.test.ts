import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBookingMerchantSender } from './resolve-booking-merchant-sender';

describe('resolveBookingMerchantSender', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the sender from the registered merchant row', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Registered Store',
        business_address: '29 Yedseram Crescent, Maitama, 904101',
        phone: '08012345678',
        registered_address: {
          city: 'Maitama',
          postal_code: '904101',
          state: 'Abuja (FCT)',
          street: '29 Yedseram Crescent',
        },
        state_code: 'FC',
      },
      error: null,
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single })),
        })),
      })),
    };

    const result = await resolveBookingMerchantSender(
      supabase as never,
      'merchant-1',
      'Fallback Name'
    );

    expect(result).toEqual({
      ok: true,
      sender: expect.objectContaining({
        name: 'Registered Store',
        phone: '08012345678',
        city: 'Maitama',
        state: 'Abuja',
        postalCode: '904101',
      }),
    });
  });

  it('returns an error when the merchant row is missing', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not found' },
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single })),
        })),
      })),
    };

    await expect(
      resolveBookingMerchantSender(supabase as never, 'merchant-1')
    ).resolves.toEqual({
      ok: false,
      error: 'Merchant details not found',
      status: 404,
    });
  });

  it('keeps transient merchant query failures retryable', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST500', message: 'database unavailable' },
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single })),
        })),
      })),
    };

    await expect(
      resolveBookingMerchantSender(supabase as never, 'merchant-1')
    ).resolves.toEqual({
      ok: false,
      error: 'Failed to resolve merchant sender',
      status: 500,
    });
  });

  it('returns an error when the merchant has no usable shipping origin', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Registered Store',
        business_address: null,
        phone: '08012345678',
        registered_address: null,
        state_code: 'FC',
      },
      error: null,
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single })),
        })),
      })),
    };

    await expect(
      resolveBookingMerchantSender(supabase as never, 'merchant-1')
    ).resolves.toEqual({
      ok: false,
      error: 'Merchant shipping origin is not configured',
      status: 400,
    });
  });
});
