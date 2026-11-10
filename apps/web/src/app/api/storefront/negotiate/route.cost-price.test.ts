import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callNegotiate, MERCHANT_ID, PRODUCT_ID } from './route.test-support';

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({}) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

describe('storefront negotiate cost_price containment', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('bugfix: shoppers must not read products.cost_price', () => {
    const product = {
      id: PRODUCT_ID,
      name: 'iPhone 15',
      brand: 'Apple',
      price: 1000,
      cost_price: 600,
      merchant_id: MERCHANT_ID,
    };

    it('never selects cost_price with the shopper client and asks the database for the floor', async () => {
      const { productSelect, rpc } = await callNegotiate(product, 900);

      expect(productSelect).toHaveBeenCalledTimes(1);
      expect(productSelect.mock.calls[0][0]).not.toContain('cost_price');
      expect(rpc).toHaveBeenCalledWith('get_negotiation_cost_floor_price', {
        p_product_id: PRODUCT_ID,
        p_merchant_id: MERCHANT_ID,
      });
    });

    it('fails closed with 500 when the cost floor lookup errors', async () => {
      const { response, body, insert } = await callNegotiate(
        product,
        500,
        1,
        undefined,
        { data: null, error: { message: 'function not found' } }
      );

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to process negotiation');
      expect(insert).not.toHaveBeenCalled();
    });

    it('fails closed with 500 when the cost floor is missing', async () => {
      const { response } = await callNegotiate(product, 500, 1, undefined, {
        data: null,
        error: null,
      });

      expect(response.status).toBe(500);
    });

    it('still refuses an offer under the database-reported cost floor', async () => {
      const { body } = await callNegotiate(
        { ...product, cost_price: 990 },
        1000 * 0.98,
        3
      );

      expect(body.status).toBe('final');
      expect(body.counterOffer).toBe(1089);
    });

    it('does not need the floor RPC for non-negotiable products', async () => {
      const { response, body, rpc } = await callNegotiate(
        { ...product, brand: 'Tecno', name: 'Tecno Spark 20' },
        500,
        1,
        undefined,
        { data: null, error: { message: 'function not found' } }
      );

      expect(response.status).toBe(200);
      expect(body.status).toBe('final');
      expect(rpc).not.toHaveBeenCalled();
    });
  });
});
