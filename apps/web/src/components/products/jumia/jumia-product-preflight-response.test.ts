import { describe, expect, it } from 'vitest';
import {
  getSafePreflightError,
  validateJumiaPreflightResponse,
} from './jumia-product-preflight-response';

const selectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceCategoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceVersion = 'd'.repeat(64);

const request = {
  merchantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  integrationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  businessClientCode: 'NG-RETAIL',
  selectionId,
  sourceCategoryId,
  sourcePage: { page: 1, limit: 1 },
  products: [{ productId, sourceVersion }],
  mappings: [
    {
      productId,
      category: { code: 12, name: 'Gaming' },
      brand: { code: 4, name: 'Nintendo' },
      attributeSetId: '11111111-1111-4111-8111-111111111111',
      attributes: {},
      bullets: ['One', 'Two', 'Three', 'Four'],
      categoryConfirmed: true as const,
    },
  ],
};

const response = {
  scope: {
    selectionId,
    sourceCategoryId,
    sourcePage: { page: 1, limit: 1 },
    productIds: [productId],
  },
  digest: `jumia-preflight-v1:${'a'.repeat(64)}`,
  products: [
    {
      productId,
      sourceVersion,
      locallyValid: false,
      blockers: ['evidence.globalPrice:global_price_unproven'],
      recordCount: 0,
    },
  ],
  canSubmit: false,
};

describe('Jumia preflight response validation', () => {
  it('accepts a response bound to the exact selected page and source versions', () => {
    expect(validateJumiaPreflightResponse(response, request)).toEqual({
      success: true,
      result: response,
    });
  });

  it('rejects a response that substitutes a selected product', () => {
    expect(
      validateJumiaPreflightResponse(
        {
          ...response,
          scope: {
            ...response.scope,
            productIds: ['22222222-2222-4222-8222-222222222222'],
          },
        },
        request
      )
    ).toMatchObject({ success: false });
  });

  it('rejects a response for a different source version', () => {
    expect(
      validateJumiaPreflightResponse(
        {
          ...response,
          products: [
            { ...response.products[0], sourceVersion: 'e'.repeat(64) },
          ],
        },
        request
      )
    ).toMatchObject({ success: false });
  });

  it('returns only a string error from a safe response shape', () => {
    expect(getSafePreflightError({ error: 'Preview unavailable' })).toBe(
      'Preview unavailable'
    );
    expect(getSafePreflightError({ error: { message: 'secret' } })).toBeNull();
    expect(getSafePreflightError(null)).toBeNull();
  });
});
