import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { prepareCheckoutIdempotencyReplay } from './checkout-idempotency-replay';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from './order-idempotency';
import { buildLegacyOrderIdempotencyPayload } from './order-idempotency-legacy';

const basePayload = {
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  delivery_method: 'airport' as const,
  airport_type: 'delivery' as const,
  items: [{ price: 1000, quantity: 1 }],
  merchant_id: '11111111-1111-1111-1111-111111111111',
};

function localeSensitivePayload() {
  return {
    ...basePayload,
    items: [
      {
        product_id: 'case',
        price: 5000,
        quantity: 1,
        variant_name: 'z',
      },
      {
        product_id: 'case',
        price: 5000,
        quantity: 1,
        variant_name: 'ö',
      },
    ],
  };
}

async function withReversedLocale<T>(run: () => Promise<T>): Promise<T> {
  const localeCompare = vi
    .spyOn(String.prototype, 'localeCompare')
    .mockImplementation(function localeOrder(this: string, other: unknown) {
      if (this === other) {
        return 0;
      }
      return this < (other as string) ? 1 : -1;
    });
  try {
    return await run();
  } finally {
    localeCompare.mockRestore();
  }
}

describe('prepareCheckoutIdempotencyReplay probe failures', () => {
  it('fails closed when the locale hash probe errors', async () => {
    await withReversedLocale(async () => {
      const payload = localeSensitivePayload();
      expect(
        hashOrderIdempotencyPayload(
          buildOrderIdempotencyPayload(payload, { itemSort: 'locale' })
        )
      ).not.toBe(
        hashOrderIdempotencyPayload(buildOrderIdempotencyPayload(payload))
      );

      const supabase = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'is_storefront_order_idempotency_hash') {
            return { data: null, error: new Error('db unavailable') };
          }
          return { data: false, error: null };
        }),
      } as unknown as SupabaseClient;

      await expect(
        prepareCheckoutIdempotencyReplay({
          canonicalAirportType: payload.airport_type,
          canonicalDeliveryMethod: payload.delivery_method,
          merchantId: payload.merchant_id,
          payload,
          requestIdempotencyKey: 'checkout-1',
          supabase,
        })
      ).rejects.toThrow('Locale checkout item-order hash probe failed');
    });
  });

  it('fails closed when the locale legacy hash probe errors', async () => {
    await withReversedLocale(async () => {
      const payload = localeSensitivePayload();
      const localeLegacyHash = hashOrderIdempotencyPayload(
        buildLegacyOrderIdempotencyPayload(payload, { itemSort: 'locale' })
      );
      const legacyHash = hashOrderIdempotencyPayload(
        buildLegacyOrderIdempotencyPayload(payload)
      );
      expect(localeLegacyHash).not.toBe(legacyHash);

      let hashProbes = 0;
      const supabase = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'is_legacy_storefront_order_idempotency_key') {
            return { data: true, error: null };
          }
          if (name === 'is_storefront_order_idempotency_hash') {
            hashProbes += 1;
            if (hashProbes === 1) {
              return { data: false, error: null };
            }
            return { data: null, error: new Error('db unavailable') };
          }
          return { data: false, error: null };
        }),
      } as unknown as SupabaseClient;

      await expect(
        prepareCheckoutIdempotencyReplay({
          canonicalAirportType: payload.airport_type,
          canonicalDeliveryMethod: payload.delivery_method,
          merchantId: payload.merchant_id,
          payload,
          requestIdempotencyKey: 'checkout-1',
          supabase,
        })
      ).rejects.toThrow('Locale legacy checkout item-order hash probe failed');
    });
  });
});
