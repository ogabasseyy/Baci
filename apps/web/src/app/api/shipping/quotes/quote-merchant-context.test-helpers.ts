import { vi } from 'vitest';
import type { ShippingAddress } from '@/lib/shipping/types';

export const callerSender: ShippingAddress = {
  name: 'Caller Origin',
  phone: '08099999999',
  address: 'Caller Road',
  city: 'Aba',
  state: 'Abia',
  country: 'Nigeria',
  countryCode: 'NG',
};

export function createRequest(headers: Record<string, string>) {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

export function createSupabase({
  domainLookupError = null,
  slugLookupError = null,
  retiredSlug = null,
  retiredMerchantId = 'merchant-renamed',
  aliasLookupError = null,
  merchantCountry,
  merchantPayoutCurrency,
}: {
  domainLookupError?: Error | null;
  slugLookupError?: Error | null;
  retiredSlug?: string | null;
  retiredMerchantId?: string;
  aliasLookupError?: Error | null;
  merchantCountry?: string | null;
  merchantPayoutCurrency?: string | null;
} = {}) {
  const from = vi.fn((table: string) => {
    const filters: Record<string, string> = {};
    const query = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return query;
      }),
      maybeSingle: vi.fn(() => {
        if (table === 'merchants' && filters.slug === 'ogabassey') {
          if (slugLookupError) {
            return Promise.resolve({ data: null, error: slugLookupError });
          }

          return Promise.resolve({ data: { id: 'merchant-1' }, error: null });
        }
        // A retired slug: the live-merchant lookup MISSES (store was renamed),
        // then the alias table resolves it to the current merchant.
        if (
          table === 'merchants' &&
          retiredSlug &&
          filters.slug === retiredSlug
        ) {
          return Promise.resolve({ data: null, error: null });
        }
        if (
          table === 'merchant_slug_aliases' &&
          retiredSlug &&
          filters.old_slug === retiredSlug
        ) {
          if (aliasLookupError) {
            return Promise.resolve({ data: null, error: aliasLookupError });
          }
          return Promise.resolve({
            data: { merchant_id: retiredMerchantId },
            error: null,
          });
        }
        if (table === 'merchants' && filters.id === retiredMerchantId) {
          return Promise.resolve({
            data: {
              business_address: '1 Merchant Road, Ikeja, Lagos',
              business_name: 'Renamed Store',
              phone: '08055554444',
            },
            error: null,
          });
        }
        if (table === 'merchants' && filters.id === 'merchant-1') {
          return Promise.resolve({
            data: {
              business_address: '1 Merchant Road, Ikeja, Lagos',
              business_name: 'Merchant Store',
              phone: '08012345678',
              ...(merchantCountry !== undefined
                ? { country: merchantCountry }
                : {}),
              ...(merchantPayoutCurrency !== undefined
                ? { payout_currency: merchantPayoutCurrency }
                : {}),
            },
            error: null,
          });
        }
        if (table === 'domains' && filters.domain === 'shop.example.com') {
          if (domainLookupError) {
            return Promise.resolve({ data: null, error: domainLookupError });
          }

          return Promise.resolve({
            data: { merchant_id: 'merchant-1' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };
    return { select: vi.fn(() => query) };
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from,
  };
}

export function createMerchantLookupClientMock(
  overrides: Record<
    string,
    {
      business_address: string;
      business_name: string;
      phone: string;
      country?: string | null;
      payout_currency?: string | null;
      registered_address?: unknown;
      state_code?: string | null;
    }
  > = {
    'merchant-1': {
      business_address: '1 Merchant Road, Ikeja, Lagos',
      business_name: 'Merchant Store',
      phone: '08012345678',
      country: 'NG',
      payout_currency: 'NGN',
    },
    'merchant-renamed': {
      business_address: '1 Merchant Road, Ikeja, Lagos',
      business_name: 'Renamed Store',
      phone: '08055554444',
    },
  }
) {
  return {
    from: vi.fn((table: string) => {
      const filters: Record<string, string> = {};
      const query = {
        eq: vi.fn((column: string, value: string) => {
          filters[column] = value;
          return query;
        }),
        maybeSingle: vi.fn(() => {
          if (table !== 'merchants' || !filters.id) {
            return Promise.resolve({ data: null, error: null });
          }

          const merchant = overrides[filters.id];
          return Promise.resolve({
            data: merchant ?? null,
            error: null,
          });
        }),
      };
      return { select: vi.fn(() => query) };
    }),
  };
}
