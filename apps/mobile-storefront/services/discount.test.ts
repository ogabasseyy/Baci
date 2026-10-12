import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import { validateDiscountCode } from './discount';

describe('validateDiscountCode', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs to the validate endpoint with normalized code + targeting and parses the response', async () => {
    const fetchMock = jest.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          valid: true,
          discount_code_id: '33333333-3333-4333-8333-333333333333',
          code: 'SAVE10',
          discount_type: 'percentage',
          discount_value: 10,
          discount_amount: 500,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock;

    const result = await validateDiscountCode({
      merchantId: 'merchant-1',
      code: ' save10 ',
      cartTotal: 5000,
      productIds: ['p-1'],
    });

    expect(result.valid).toBe(true);
    const call = fetchMock.mock.calls[0];
    const url = call[0];
    const init = call[1];
    expect(String(url)).toContain('/api/storefront/discount/validate');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.merchant_id).toBe('merchant-1');
    expect(body.code).toBe('SAVE10');
    expect(body.cart_total).toBe(5000);
    expect(body.product_ids).toEqual(['p-1']);
  });

  it('parses a rejected response', async () => {
    const fetchMock = jest
      .fn<FetchImplementation>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ valid: false, error: 'Invalid discount code' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    global.fetch = fetchMock;

    const result = await validateDiscountCode({
      merchantId: 'merchant-1',
      code: 'NOPE',
      cartTotal: 5000,
    });

    expect(result.valid).toBe(false);
  });

  it('throws when the endpoint returns a non-ok HTTP response', async () => {
    const fetchMock = jest.fn<FetchImplementation>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    global.fetch = fetchMock;

    await expect(
      validateDiscountCode({
        merchantId: 'merchant-1',
        code: 'SAVE10',
        cartTotal: 5000,
      })
    ).rejects.toThrow('Discount validation failed: 429');
  });

  it('throws when the response fails schema validation', async () => {
    const fetchMock = jest.fn<FetchImplementation>().mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    global.fetch = fetchMock;

    await expect(
      validateDiscountCode({
        merchantId: 'merchant-1',
        code: 'SAVE10',
        cartTotal: 5000,
      })
    ).rejects.toThrow('Invalid discount validation response from server');
  });
});
