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

function rpcClient(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

describe('prepareCheckoutIdempotencyReplay', () => {
  it('uses the current hash when the legacy probe fails', async () => {
    const supabase = rpcClient(false, new Error('probe unavailable'));
    const expectedHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload(basePayload)
    );

    await expect(
      prepareCheckoutIdempotencyReplay({
        ...basePayload,
        canonicalAirportType: basePayload.airport_type,
        canonicalDeliveryMethod: basePayload.delivery_method,
        merchantId: basePayload.merchant_id,
        payload: basePayload,
        requestIdempotencyKey: 'checkout-1',
        supabase,
      })
    ).resolves.toEqual({
      checkoutRequestHash: expectedHash,
      isLegacyIdempotencyReplay: false,
    });
  });

  it('uses the legacy hash only when the database confirms a legacy order', async () => {
    const supabase = rpcClient(true);
    const expectedHash = hashOrderIdempotencyPayload(
      buildLegacyOrderIdempotencyPayload(basePayload)
    );

    await expect(
      prepareCheckoutIdempotencyReplay({
        canonicalAirportType: basePayload.airport_type,
        canonicalDeliveryMethod: basePayload.delivery_method,
        merchantId: basePayload.merchant_id,
        payload: basePayload,
        requestIdempotencyKey: 'checkout-1',
        supabase,
      })
    ).resolves.toEqual({
      checkoutRequestHash: expectedHash,
      isLegacyIdempotencyReplay: true,
    });
  });

  it('does not build or probe a hash when idempotency is absent', async () => {
    const supabase = rpcClient(false);

    await expect(
      prepareCheckoutIdempotencyReplay({
        canonicalAirportType: basePayload.airport_type,
        canonicalDeliveryMethod: basePayload.delivery_method,
        merchantId: basePayload.merchant_id,
        payload: basePayload,
        requestIdempotencyKey: null,
        supabase,
      })
    ).resolves.toEqual({
      checkoutRequestHash: null,
      isLegacyIdempotencyReplay: false,
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('uses the locale item-order hash when that hash is already stored', async () => {
    const localeCompare = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(function localeOrder(this: string, other: unknown) {
        if (this === other) {
          return 0;
        }
        return this < (other as string) ? 1 : -1;
      });

    try {
      const payload = {
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
      const localeHash = hashOrderIdempotencyPayload(
        buildOrderIdempotencyPayload(payload, { itemSort: 'locale' })
      );
      const currentHash = hashOrderIdempotencyPayload(
        buildOrderIdempotencyPayload(payload)
      );
      expect(localeHash).not.toBe(currentHash);

      const supabase = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'is_storefront_order_idempotency_hash') {
            return { data: true, error: null };
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
      ).resolves.toEqual({
        checkoutRequestHash: localeHash,
        isLegacyIdempotencyReplay: false,
      });
    } finally {
      localeCompare.mockRestore();
    }
  });

  it('uses the locale legacy hash when a pre-metadata order stored it', async () => {
    const localeCompare = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(function localeOrder(this: string, other: unknown) {
        if (this === other) {
          return 0;
        }
        return this < (other as string) ? 1 : -1;
      });

    try {
      const payload = {
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
      const localeLegacyHash = hashOrderIdempotencyPayload(
        buildLegacyOrderIdempotencyPayload(payload, { itemSort: 'locale' })
      );
      const legacyHash = hashOrderIdempotencyPayload(
        buildLegacyOrderIdempotencyPayload(payload)
      );
      expect(localeLegacyHash).not.toBe(legacyHash);

      const rpc = vi.fn(
        async (name: string, params?: Record<string, string>) => {
          if (name === 'is_legacy_storefront_order_idempotency_key') {
            return { data: true, error: null };
          }
          if (name === 'is_storefront_order_idempotency_hash') {
            return {
              data: params?.p_checkout_request_hash === localeLegacyHash,
              error: null,
            };
          }
          return { data: false, error: null };
        }
      );
      const supabase = { rpc } as unknown as SupabaseClient;

      await expect(
        prepareCheckoutIdempotencyReplay({
          canonicalAirportType: payload.airport_type,
          canonicalDeliveryMethod: payload.delivery_method,
          merchantId: payload.merchant_id,
          payload,
          requestIdempotencyKey: 'checkout-1',
          supabase,
        })
      ).resolves.toEqual({
        checkoutRequestHash: localeLegacyHash,
        isLegacyIdempotencyReplay: true,
      });
      expect(rpc).toHaveBeenCalledWith(
        'is_storefront_order_idempotency_hash',
        expect.objectContaining({ p_checkout_request_hash: localeLegacyHash })
      );
    } finally {
      localeCompare.mockRestore();
    }
  });
});
