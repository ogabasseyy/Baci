import { describe, expect, it } from 'vitest';
import type { JumiaGamingDraftPage } from '@/schemas/jumia/selection-draft';
import type { JumiaMappingDraft } from './jumia-mapping-draft-types';
import { buildJumiaPagePreflightRequest } from './jumia-product-preflight-request';

const merchantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const integrationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const productId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sourceVersion = 'e'.repeat(64);

const page: JumiaGamingDraftPage = {
  selectionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  sourceCategoryId: categoryId,
  total: 2,
  page: 1,
  limit: 2,
  totalPages: 1,
  products: [
    {
      id: productId,
      ordinal: 1,
      available: true,
      capturedSourceVersion: sourceVersion,
      currentSourceVersion: sourceVersion,
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      ordinal: 2,
      available: false,
      capturedSourceVersion: sourceVersion,
      currentSourceVersion: 'f'.repeat(64),
    },
  ],
};

const mapping: JumiaMappingDraft = {
  merchantId,
  integrationId,
  businessClientCode: 'NG-RETAIL',
  countryCode: 'NG',
  category: { code: 1, name: 'Gaming', attributeSetId: 'attribute-set' },
  brand: { code: 2, name: 'Nintendo' },
  attributeSetId: 'attribute-set',
  attributes: { '4': true, '5': undefined },
  bullets: ['One', 'Two', 'Three', 'Four'],
  categoryConfirmed: true,
};

describe('buildJumiaPagePreflightRequest', () => {
  it('includes only eligible same-snapshot products and strips undefined values', () => {
    const built = buildJumiaPagePreflightRequest({
      merchantId,
      integrationId,
      page,
      selectedDraft: {
        [productId]: {
          id: productId,
          sourceCategoryId: categoryId,
          capturedSourceVersion: sourceVersion,
        },
        '11111111-1111-4111-8111-111111111111': {
          id: '11111111-1111-4111-8111-111111111111',
          sourceCategoryId: categoryId,
          capturedSourceVersion: sourceVersion,
        },
      },
      mapping,
    });

    expect(built.currentPageSelection).toEqual([{ productId, sourceVersion }]);
    expect(built.selectedCount).toBe(2);
    expect(built.requestBody).toMatchObject({
      products: [{ productId, sourceVersion }],
      sourcePage: { page: 1, limit: 2 },
      mappings: [{ attributes: { '4': true } }],
    });
    expect(built.requestBody).not.toHaveProperty('evidence');
  });
});
