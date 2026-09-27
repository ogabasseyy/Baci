import { describe, expect, it } from 'vitest';
import {
  JumiaApiErrorSchema,
  JumiaAttributeSetResponseSchema,
  JumiaBrandsResponseSchema,
  JumiaCancelResponseSchema,
  JumiaCategoriesResponseSchema,
  JumiaConsignmentCreateResponseSchema,
  JumiaConsignmentStockResponseSchema,
  JumiaFeedCreateResponseSchema,
  JumiaFeedDetailsResponseSchema,
  JumiaOrderItemsResponseSchema,
  JumiaOrdersResponseSchema,
  JumiaPackV2ResponseSchema,
  JumiaPrintLabelsResponseSchema,
  JumiaProductsResponseSchema,
  JumiaReadyToShipResponseSchema,
  JumiaShipmentProvidersResponseSchema,
  JumiaShopsResponseSchema,
  JumiaStockResponseSchema,
  JumiaTokenErrorSchema,
  JumiaTokenResponseSchema,
} from '@/schemas/jumia';

// ── Sample responses from Jumia Vendor API Postman collection
//    (see Jumia Vendor API Postman collection) ──

const validTokenResponse = {
  access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test',
  expires_in: 3600,
  refresh_token: 'dGVzdC1yZWZyZXNoLXRva2Vu',
  refresh_expires_in: 7776000,
  token_type: 'Bearer',
};

const validShopsResponse = {
  shops: [
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'My Jumia Shop',
      email: 'shop@example.com',
      businessClients: [
        {
          name: 'Jumia Nigeria',
          code: 'jumia_ng',
          countryCode: 'NG',
          countryName: 'Nigeria',
          status: 'active',
          shortCode: 'NG',
        },
      ],
    },
  ],
};

const validProductsResponse = {
  products: [
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'iPhone 15 Pro Max',
      description: 'Latest Apple flagship',
      parentSku: 'IPHONE-15-PM',
      shop: { id: '550e8400-e29b-41d4-a716-446655440000' },
      brand: { code: 123, name: 'Apple' },
      category: { code: 456, name: 'Smartphones' },
      images: [
        {
          url: 'https://cdn.jumia.com/img1.jpg',
          originalUrl: 'https://cdn.jumia.com/img1-orig.jpg',
          primary: true,
        },
      ],
      attributeSetId: '550e8400-e29b-41d4-a716-446655440002',
      attributes: [
        {
          id: '550e8400-e29b-41d4-a716-446655440003',
          name: 'Color',
          value: 'Black',
          translations: [{ language: 'en', value: 'Black' }],
        },
      ],
      createdAt: '2025-03-24T10:00:00.000Z',
      updatedAt: '2025-03-24T12:00:00.000Z',
      variations: [
        {
          id: '550e8400-e29b-41d4-a716-446655440004',
          sellerSku: 'IPHONE-15-PM-256-BLK',
          barcodeEan: '1234567890123',
          variation: '256GB Black',
          globalPrice: {
            value: 750000,
            updateAt: '2025-03-24T10:00:00.000Z',
            salePrice: {
              value: 700000,
              startAt: '2025-03-20T00:00:00.000Z',
              endAt: '2025-03-30T23:59:59.000Z',
            },
          },
          attributes: [
            {
              id: '550e8400-e29b-41d4-a716-446655440005',
              name: 'Storage',
              value: '256GB',
              translations: [],
            },
          ],
        },
      ],
    },
  ],
  nextToken: 'eyJwYWdlIjogMn0=',
  isLastPage: false,
};

const validCategoriesResponse = {
  categories: [
    {
      code: 100,
      name: 'Smartphones',
      completePath: 'Electronics > Phones > Smartphones',
      attributeSet: {
        id: '550e8400-e29b-41d4-a716-446655440006',
        name: 'Mobile Phone Attributes',
      },
    },
  ],
};

const validBrandsResponse = {
  brands: [
    { code: 1, name: 'Apple' },
    { code: 2, name: 'Samsung' },
  ],
  page: {
    current: 1,
    totalOfPages: 3,
  },
};

const validAttributeSetResponse = {
  attributes: [
    {
      code: 10,
      name: 'Color',
      description: 'Product color',
      type: 'option',
      mandatory: true,
      variation: true,
      translatable: true,
      sid: '550e8400-e29b-41d4-a716-446655440007',
      translations: [
        { languageCode: 'en', translation: 'Color', languageId: 1 },
      ],
      options: [
        {
          id: '550e8400-e29b-41d4-a716-446655440008',
          name: 'Black',
          position: 1,
          isDefault: true,
        },
      ],
      validations: [
        {
          MaxLength: 50,
          MinLength: 1,
        },
      ],
    },
  ],
};

const validStockResponse = {
  products: [
    {
      id: '550e8400-e29b-41d4-a716-446655440009',
      sellerSku: 'IPHONE-15-PM-256-BLK',
      globalStock: 50,
      lastStockUpdatedAt: '2025-03-24T10:00:00.000Z',
    },
  ],
  nextToken: 'abc123',
  isLastPage: false,
};

const validOrdersResponse = {
  orders: [
    {
      id: '550e8400-e29b-41d4-a716-44665544000a',
      shopIds: ['550e8400-e29b-41d4-a716-446655440000'],
      totalItems: 3,
      packedItems: 1,
      isPrepayment: false,
      hasMultipleStatus: true,
      hasItemsFulfilledByJumia: false,
      pendingSince: '2025-03-22T16:23:55.000Z',
      status: 'PENDING',
      deliveryOption: 'Economy Shipping',
      number: 'ORD-12345678',
      totalAmount: { currency: 'NGN', value: 250000.5 },
      country: { code: 'NG', name: 'Nigeria', currencyCode: 'NGN' },
      shippingAddress: {
        firstName: 'John',
        lastName: 'Doe',
        address: '123 Test Street',
        city: 'Lagos',
        postalCode: '100001',
        ward: 'Ikeja',
        region: 'Lagos',
        countryName: 'Nigeria',
      },
      createdAt: '2025-03-24T16:23:55.000Z',
      updatedAt: '2025-03-24T16:30:00.000Z',
      totalAmountLocal: { currency: 'NGN', value: 250000.5 },
    },
  ],
  isLastPage: true,
  nextToken: null,
};

const validOrderItemsResponse = {
  orderId: '550e8400-e29b-41d4-a716-44665544000a',
  orderNumber: 'ORD-12345678',
  items: [
    {
      id: '550e8400-e29b-41d4-a716-44665544000b',
      shopId: '550e8400-e29b-41d4-a716-446655440000',
      product: {
        name: 'iPhone 15 Pro Max',
        sellerSku: 'IPHONE-15-PM-256-BLK',
        imageUrl: 'https://cdn.jumia.com/img1.jpg',
      },
      status: 'PENDING',
      trackingNumber: '',
      trackingUrl: 'https://tracking.jumia.com/pending',
      shipmentType: 'Dropshipping',
      deliveryOption: 'Economy Shipping',
      isFulfilledByJumia: false,
      itemPrice: 750000,
      paidPrice: 700000,
      shippingAmount: 2500,
      itemPriceLocal: 750000,
      paidPriceLocal: 700000,
      shippingAmountLocal: 2500,
      exchangeRate: 1.0,
      country: { code: 'NG', name: 'Nigeria', currencyCode: 'NGN' },
      taxAmount: 0,
      voucherAmount: 50000,
      shippingAddress: {
        firstName: 'John',
        lastName: 'Doe',
        address: '123 Test Street',
        city: 'Lagos',
        postalCode: '100001',
        ward: 'Ikeja',
        region: 'Lagos',
        countryName: 'Nigeria',
      },
    },
  ],
};

const validShipmentProvidersResponse = {
  orderItems: [
    {
      id: '550e8400-e29b-41d4-a716-44665544000b',
      shipmentProviders: [
        {
          id: '550e8400-e29b-41d4-a716-44665544000c',
          name: 'GIG Logistics',
          trackingCodeRequired: true,
        },
      ],
    },
  ],
};

const validPackV2Response = {
  success: {
    packages: [
      {
        orderItems: ['550e8400-e29b-41d4-a716-44665544000b'],
        trackingCode: 'TRK-001',
        countryCode: 'NG',
      },
    ],
    total: 1,
  },
  error: {
    packages: [],
    total: 0,
  },
};

const validReadyToShipResponse = {
  success: {
    packages: [
      {
        orderItems: ['550e8400-e29b-41d4-a716-44665544000b'],
        trackingNumber: 'TRK-001',
        countryCode: 'NG',
      },
    ],
    total: 1,
  },
  error: {
    orderItems: [],
    total: 0,
  },
};

const validCancelResponse = {
  success: {
    orderItems: [
      {
        id: '550e8400-e29b-41d4-a716-44665544000b',
        countryCode: 'NG',
        cancellationReason: {
          id: '550e8400-e29b-41d4-a716-44665544000d',
          description: 'Out of stock',
        },
      },
    ],
    total: 1,
  },
  error: {
    orderItems: [],
    total: 0,
  },
};

const validPrintLabelsResponse = {
  success: {
    labels: [
      {
        orderItemIds: ['550e8400-e29b-41d4-a716-44665544000b'],
        trackingNumber: 'TRK-001',
        countryCode: 'NG',
        label: 'bGFiZWxfY29udGVudA==',
      },
    ],
    total: 1,
  },
  error: {
    orderItems: [],
    total: 0,
  },
};

const validFeedCreateResponse = {
  feedId: '550e8400-e29b-41d4-a716-44665544000e',
};

const validFeedDetailsResponse = {
  feedSid: '550e8400-e29b-41d4-a716-44665544000e',
  status: 'COMPLETED',
  feedType: 'ProductCreate',
  feedSource: 'API',
  total: 10,
  completed: 8,
  failed: 2,
  createdBy: {
    sid: '550e8400-e29b-41d4-a716-44665544000f',
    name: 'API User',
    email: 'api@example.com',
  },
  reportUrl: 'https://feeds.jumia.com/reports/feed-001.csv',
  errorMessage: '',
  feedItems: [
    {
      status: 'FAILED',
      productSid: '550e8400-e29b-41d4-a716-446655440010',
      sellerSKU: 'FAIL-SKU-001',
      createdAt: '2025-03-24T10:00:00.000Z',
      updatedAt: '2025-03-24T10:05:00.000Z',
      errorMessage: 'Invalid brand code',
      errors: {
        globalMessages: ['Brand code not found'],
        businessClients: {
          code: 'jumia_ng',
          messages: ['Not approved for this country'],
        },
      },
    },
  ],
};

// ── Tests ──

describe('Jumia Vendor API Schemas', () => {
  describe('JumiaTokenResponseSchema', () => {
    it('parses a valid token response', () => {
      const result = JumiaTokenResponseSchema.safeParse(validTokenResponse);
      expect(result.success).toBe(true);
    });

    it('rejects missing access_token', () => {
      const { access_token: _, ...incomplete } = validTokenResponse;
      const result = JumiaTokenResponseSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('access_token');
      }
    });

    it('rejects non-numeric expires_in', () => {
      const result = JumiaTokenResponseSchema.safeParse({
        ...validTokenResponse,
        expires_in: 'not-a-number',
      });
      expect(result.success).toBe(false);
    });

    it('coerces string-encoded numeric expires_in', () => {
      const result = JumiaTokenResponseSchema.safeParse({
        ...validTokenResponse,
        expires_in: '3600',
        refresh_expires_in: '7776000',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expires_in).toBe(3600);
        expect(result.data.refresh_expires_in).toBe(7776000);
      }
    });

    it('accepts any non-empty token_type string', () => {
      const result = JumiaTokenResponseSchema.safeParse({
        ...validTokenResponse,
        token_type: 'bearer',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty or null token_type', () => {
      for (const token_type of ['', '   ', null]) {
        const result = JumiaTokenResponseSchema.safeParse({
          ...validTokenResponse,
          token_type,
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects non-numeric string expires_in and refresh_expires_in', () => {
      for (const bad of ['abc', '', 'true']) {
        const result = JumiaTokenResponseSchema.safeParse({
          ...validTokenResponse,
          expires_in: bad,
          refresh_expires_in: bad,
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects boolean and array values for expires_in', () => {
      for (const bad of [true, false, [3600]]) {
        const result = JumiaTokenResponseSchema.safeParse({
          ...validTokenResponse,
          expires_in: bad,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('JumiaShopsResponseSchema', () => {
    it('parses a valid shops response', () => {
      const result = JumiaShopsResponseSchema.safeParse(validShopsResponse);
      expect(result.success).toBe(true);
    });

    it('parses a valid bare shops array response', () => {
      const result = JumiaShopsResponseSchema.safeParse(
        validShopsResponse.shops
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shops).toHaveLength(1);
        expect(result.data.shops[0].id).toBe(validShopsResponse.shops[0].id);
      }
    });

    it('parses shops with multiple businessClients', () => {
      const multiClient = {
        shops: [
          {
            ...validShopsResponse.shops[0],
            businessClients: [
              ...validShopsResponse.shops[0].businessClients,
              {
                name: 'Jumia Kenya',
                code: 'jumia_ke',
                countryCode: 'KE',
                countryName: 'Kenya',
                status: 'active',
                shortCode: 'KE',
              },
            ],
          },
        ],
      };
      const result = JumiaShopsResponseSchema.safeParse(multiClient);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shops[0].businessClients).toHaveLength(2);
      }
    });

    it('normalizes missing countryName and uppercase business client status', () => {
      const result = JumiaShopsResponseSchema.safeParse({
        shops: [
          {
            ...validShopsResponse.shops[0],
            businessClients: [
              {
                ...validShopsResponse.shops[0].businessClients[0],
                countryName: undefined,
                status: 'ACTIVE',
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shops[0].businessClients[0].countryName).toBe('');
        expect(result.data.shops[0].businessClients[0].status).toBe('active');
      }
    });

    it('rejects shop with empty businessClients', () => {
      const empty = {
        shops: [{ ...validShopsResponse.shops[0], businessClients: [] }],
      };
      const result = JumiaShopsResponseSchema.safeParse(empty);
      expect(result.success).toBe(false);
    });

    it('rejects shop without id', () => {
      const { id: _, ...shopWithoutId } = validShopsResponse.shops[0];
      const result = JumiaShopsResponseSchema.safeParse({
        shops: [shopWithoutId],
      });
      expect(result.success).toBe(false);
    });

    it('rejects shop with invalid email', () => {
      const result = JumiaShopsResponseSchema.safeParse({
        shops: [{ ...validShopsResponse.shops[0], email: 'not-an-email' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects shop with empty name', () => {
      const result = JumiaShopsResponseSchema.safeParse({
        shops: [{ ...validShopsResponse.shops[0], name: '' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects response with empty shops array', () => {
      const result = JumiaShopsResponseSchema.safeParse({ shops: [] });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaProductsResponseSchema', () => {
    it('parses a valid products response with pagination', () => {
      const result = JumiaProductsResponseSchema.safeParse(
        validProductsResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nextToken).toBe('eyJwYWdlIjogMn0=');
        expect(result.data.isLastPage).toBe(false);
      }
    });

    it('parses products with no variations', () => {
      const noVariations = {
        ...validProductsResponse,
        products: [{ ...validProductsResponse.products[0], variations: [] }],
      };
      const result = JumiaProductsResponseSchema.safeParse(noVariations);
      expect(result.success).toBe(true);
    });

    it('parses last page with null nextToken', () => {
      const lastPage = {
        ...validProductsResponse,
        nextToken: null,
        isLastPage: true,
      };
      const result = JumiaProductsResponseSchema.safeParse(lastPage);
      expect(result.success).toBe(true);
    });

    it('parses products with sale price', () => {
      const result = JumiaProductsResponseSchema.safeParse(
        validProductsResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        const salePrice =
          result.data.products[0].variations[0].globalPrice.salePrice;
        expect(salePrice?.value).toBe(700000);
      }
    });

    it('parses empty products array', () => {
      const result = JumiaProductsResponseSchema.safeParse({
        products: [],
        nextToken: null,
        isLastPage: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects product with invalid image URL', () => {
      const badProduct = {
        ...validProductsResponse,
        products: [
          {
            ...validProductsResponse.products[0],
            images: [
              {
                url: 'not-a-url',
                originalUrl: 'also-not-a-url',
                primary: true,
              },
            ],
          },
        ],
      };
      const result = JumiaProductsResponseSchema.safeParse(badProduct);
      expect(result.success).toBe(false);
    });

    it('rejects product with empty name', () => {
      const result = JumiaProductsResponseSchema.safeParse({
        ...validProductsResponse,
        products: [{ ...validProductsResponse.products[0], name: '' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing products key', () => {
      const result = JumiaProductsResponseSchema.safeParse({
        isLastPage: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaCategoriesResponseSchema', () => {
    it('parses a valid flat categories response', () => {
      const result = JumiaCategoriesResponseSchema.safeParse(
        validCategoriesResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories[0].completePath).toBe(
          'Electronics > Phones > Smartphones'
        );
      }
    });

    it('parses empty categories list', () => {
      const result = JumiaCategoriesResponseSchema.safeParse({
        categories: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects category with empty name', () => {
      const result = JumiaCategoriesResponseSchema.safeParse({
        categories: [{ ...validCategoriesResponse.categories[0], name: '' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing categories key', () => {
      const result = JumiaCategoriesResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaBrandsResponseSchema', () => {
    it('parses a valid brands response with pagination', () => {
      const result = JumiaBrandsResponseSchema.safeParse(validBrandsResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page.totalOfPages).toBe(3);
      }
    });

    it('rejects brands without page info', () => {
      const { page: _, ...noPagination } = validBrandsResponse;
      const result = JumiaBrandsResponseSchema.safeParse(noPagination);
      expect(result.success).toBe(false);
    });

    it('parses empty brands array', () => {
      const result = JumiaBrandsResponseSchema.safeParse({
        brands: [],
        page: { current: 1, totalOfPages: 0 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('JumiaAttributeSetResponseSchema', () => {
    it('parses a valid attribute set response', () => {
      const result = JumiaAttributeSetResponseSchema.safeParse(
        validAttributeSetResponse
      );
      expect(result.success).toBe(true);
    });

    it('parses attributes with minimal/empty values', () => {
      const minimal = {
        attributes: [
          {
            code: 10,
            name: 'Color',
            description: '',
            type: 'option',
            mandatory: false,
            variation: false,
            translatable: false,
            sid: '550e8400-e29b-41d4-a716-446655440007',
            translations: [],
            options: [],
            validations: [],
          },
        ],
      };
      const result = JumiaAttributeSetResponseSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it('rejects attribute missing mandatory boolean', () => {
      const { mandatory: _, ...noMandatory } =
        validAttributeSetResponse.attributes[0];
      const result = JumiaAttributeSetResponseSchema.safeParse({
        attributes: [noMandatory],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaStockResponseSchema', () => {
    it('parses a valid stock response with pagination', () => {
      const result = JumiaStockResponseSchema.safeParse(validStockResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isLastPage).toBe(false);
      }
    });

    it('rejects stock product missing sellerSku', () => {
      const result = JumiaStockResponseSchema.safeParse({
        products: [
          {
            id: 'P-1',
            globalStock: 50,
            lastStockUpdatedAt: '2025-01-01T00:00:00Z',
          },
        ],
        isLastPage: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects stock product missing globalStock', () => {
      const result = JumiaStockResponseSchema.safeParse({
        products: [
          {
            id: 'P-1',
            sellerSku: 'SKU-1',
            lastStockUpdatedAt: '2025-01-01T00:00:00Z',
          },
        ],
        isLastPage: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing products key', () => {
      const result = JumiaStockResponseSchema.safeParse({ isLastPage: true });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaOrdersResponseSchema', () => {
    it('parses a valid orders response', () => {
      const result = JumiaOrdersResponseSchema.safeParse(validOrdersResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orders[0].number).toBe('ORD-12345678');
        expect(result.data.isLastPage).toBe(true);
      }
    });

    it('parses orders with null nextToken on last page', () => {
      const result = JumiaOrdersResponseSchema.safeParse(validOrdersResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nextToken).toBeNull();
      }
    });

    it('parses orders with currency amounts', () => {
      const result = JumiaOrdersResponseSchema.safeParse(validOrdersResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orders[0].totalAmount.currency).toBe('NGN');
        expect(result.data.orders[0].totalAmount.value).toBe(250000.5);
      }
    });

    it('rejects order with empty currency string', () => {
      const badOrder = {
        ...validOrdersResponse,
        orders: [
          {
            ...validOrdersResponse.orders[0],
            totalAmount: { currency: '', value: 100 },
          },
        ],
      };
      const result = JumiaOrdersResponseSchema.safeParse(badOrder);
      expect(result.success).toBe(false);
    });

    it('parses order without pendingSince (non-pending order)', () => {
      const { pendingSince: _, ...orderWithoutPending } =
        validOrdersResponse.orders[0];
      const result = JumiaOrdersResponseSchema.safeParse({
        ...validOrdersResponse,
        orders: [orderWithoutPending],
      });
      expect(result.success).toBe(true);
    });

    it('parses empty orders array', () => {
      const result = JumiaOrdersResponseSchema.safeParse({
        orders: [],
        isLastPage: true,
        nextToken: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing orders key', () => {
      const result = JumiaOrdersResponseSchema.safeParse({
        isLastPage: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaOrderItemsResponseSchema', () => {
    it('parses a valid order items response', () => {
      const result = JumiaOrderItemsResponseSchema.safeParse(
        validOrderItemsResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items[0].product.sellerSku).toBe(
          'IPHONE-15-PM-256-BLK'
        );
      }
    });

    it('parses items with pricing fields', () => {
      const result = JumiaOrderItemsResponseSchema.safeParse(
        validOrderItemsResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        const item = result.data.items[0];
        expect(item.itemPrice).toBe(750000);
        expect(item.paidPrice).toBe(700000);
        expect(item.voucherAmount).toBe(50000);
      }
    });

    it('rejects item with invalid imageUrl', () => {
      const result = JumiaOrderItemsResponseSchema.safeParse({
        ...validOrderItemsResponse,
        items: [
          {
            ...validOrderItemsResponse.items[0],
            product: {
              ...validOrderItemsResponse.items[0].product,
              imageUrl: 'not-a-url',
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('accepts item with empty trackingUrl (pending order)', () => {
      const result = JumiaOrderItemsResponseSchema.safeParse({
        ...validOrderItemsResponse,
        items: [
          {
            ...validOrderItemsResponse.items[0],
            trackingUrl: '',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('parses empty items array', () => {
      const result = JumiaOrderItemsResponseSchema.safeParse({
        orderId: 'order-1',
        orderNumber: 'ORD-1',
        items: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing orderId', () => {
      const { orderId: _, ...noOrderId } = validOrderItemsResponse;
      const result = JumiaOrderItemsResponseSchema.safeParse(noOrderId);
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaShipmentProvidersResponseSchema', () => {
    it('parses a valid shipment providers response', () => {
      const result = JumiaShipmentProvidersResponseSchema.safeParse(
        validShipmentProvidersResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orderItems[0].shipmentProviders[0].name).toBe(
          'GIG Logistics'
        );
      }
    });

    it('rejects shipment provider missing id field', () => {
      const result = JumiaShipmentProvidersResponseSchema.safeParse({
        orderItems: [
          {
            id: 'ITEM-1',
            shipmentProviders: [{ name: 'DHL', requireTrackingCode: true }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects shipment provider missing trackingCodeRequired', () => {
      const result = JumiaShipmentProvidersResponseSchema.safeParse({
        orderItems: [
          {
            id: 'ITEM-1',
            shipmentProviders: [{ id: 'SP-1', name: 'DHL' }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing orderItems key', () => {
      const result = JumiaShipmentProvidersResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaPackV2ResponseSchema', () => {
    it('parses a successful V2 pack response', () => {
      const result = JumiaPackV2ResponseSchema.safeParse(validPackV2Response);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success?.total).toBe(1);
      }
    });

    it('parses V2 pack with errors', () => {
      const withErrors = {
        success: { packages: [], total: 0 },
        error: {
          packages: [
            {
              orderItems: ['550e8400-e29b-41d4-a716-44665544000b'],
              error: 'Item already packed',
            },
          ],
          total: 1,
        },
      };
      const result = JumiaPackV2ResponseSchema.safeParse(withErrors);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error?.total).toBe(1);
      }
    });

    it('accepts response with only error key', () => {
      const result = JumiaPackV2ResponseSchema.safeParse({
        error: { packages: [], total: 0 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('JumiaReadyToShipResponseSchema', () => {
    it('parses a valid ready-to-ship response', () => {
      const result = JumiaReadyToShipResponseSchema.safeParse(
        validReadyToShipResponse
      );
      expect(result.success).toBe(true);
    });

    it('accepts response with only error key', () => {
      const result = JumiaReadyToShipResponseSchema.safeParse({
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts response with only success key', () => {
      const result = JumiaReadyToShipResponseSchema.safeParse({
        success: { packages: [], total: 0 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-numeric total in success', () => {
      const result = JumiaReadyToShipResponseSchema.safeParse({
        success: { packages: [], total: 'one' },
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaCancelResponseSchema', () => {
    it('parses a valid cancel response', () => {
      const result = JumiaCancelResponseSchema.safeParse(validCancelResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          result.data.success?.orderItems[0].cancellationReason.description
        ).toBe('Out of stock');
      }
    });

    it('accepts cancel response with only error key', () => {
      const result = JumiaCancelResponseSchema.safeParse({
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects success orderItem missing id', () => {
      const result = JumiaCancelResponseSchema.safeParse({
        success: {
          orderItems: [
            { cancellationReason: { id: 'CR-1', description: 'Out of stock' } },
          ],
          total: 1,
        },
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('rejects success orderItem with missing cancellationReason', () => {
      const result = JumiaCancelResponseSchema.safeParse({
        success: {
          orderItems: [{ id: 'ITEM-1' }],
          total: 1,
        },
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaPrintLabelsResponseSchema', () => {
    it('parses a valid print labels response', () => {
      const result = JumiaPrintLabelsResponseSchema.safeParse(
        validPrintLabelsResponse
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success?.labels[0].label).toBe(
          'bGFiZWxfY29udGVudA=='
        );
      }
    });

    it('accepts print labels response with only error key', () => {
      const result = JumiaPrintLabelsResponseSchema.safeParse({
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects label missing trackingNumber field', () => {
      const result = JumiaPrintLabelsResponseSchema.safeParse({
        success: {
          labels: [
            {
              orderItemIds: ['ITEM-1'],
              countryCode: 'NG',
              label: 'bGFiZWxfY29udGVudA==',
            },
          ],
          total: 1,
        },
        error: { orderItems: [], total: 0 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaFeedCreateResponseSchema', () => {
    it('parses a valid feed create response', () => {
      const result = JumiaFeedCreateResponseSchema.safeParse(
        validFeedCreateResponse
      );
      expect(result.success).toBe(true);
    });

    it('rejects object with feedId removed', () => {
      const { feedId: _, ...noFeedId } = validFeedCreateResponse;
      const result = JumiaFeedCreateResponseSchema.safeParse(noFeedId);
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaFeedDetailsResponseSchema', () => {
    it('parses a valid feed details response', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse(
        validFeedDetailsResponse
      );
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.data.feedItems[0].sellerSKU).toBe('FAIL-SKU-001');
      expect(result.data.feedItems[0].errors?.globalMessages).toContain(
        'Brand code not found'
      );
    });

    it('parses feed details with null reportUrl (in-progress feed)', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...validFeedDetailsResponse,
        reportUrl: null,
      });
      expect(result.success).toBe(true);
    });

    it('parses feed details with missing reportUrl', () => {
      const { reportUrl: _, ...noReportUrl } = validFeedDetailsResponse;
      const result = JumiaFeedDetailsResponseSchema.safeParse(noReportUrl);
      expect(result.success).toBe(true);
    });

    it('parses feed details with no items', () => {
      const { feedItems: _, ...noItems } = validFeedDetailsResponse;
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...noItems,
        feedItems: [],
      });
      expect(result.success).toBe(true);
    });

    it('parses rejected feed items without a provider product id', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...validFeedDetailsResponse,
        feedItems: [
          {
            ...validFeedDetailsResponse.feedItems[0],
            status: 'FAILED',
            productSid: undefined,
          },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('rejects feed details missing feedSid', () => {
      const { feedSid: _, ...noFeedSid } = validFeedDetailsResponse;
      const result = JumiaFeedDetailsResponseSchema.safeParse(noFeedSid);
      expect(result.success).toBe(false);
    });

    it('rejects feed details with non-numeric total', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...validFeedDetailsResponse,
        total: 'many',
      });
      expect(result.success).toBe(false);
    });

    it('rejects feed details with invalid createdBy email', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...validFeedDetailsResponse,
        createdBy: { sid: 'X', name: 'User', email: 'not-an-email' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects feed details with invalid reportUrl', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...validFeedDetailsResponse,
        reportUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('rejects feed details with empty feedType', () => {
      const result = JumiaFeedDetailsResponseSchema.safeParse({
        ...validFeedDetailsResponse,
        feedType: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaApiErrorSchema', () => {
    it('parses a standard API error', () => {
      const error = {
        code: 'UNAUTHORIZED',
        data: [{ code: '401', message: 'Token expired' }],
      };
      const result = JumiaApiErrorSchema.safeParse(error);
      expect(result.success).toBe(true);
    });

    it('rejects error with empty data array (min 1 element required)', () => {
      const result = JumiaApiErrorSchema.safeParse({
        code: 'UNKNOWN',
        data: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing code field', () => {
      const result = JumiaApiErrorSchema.safeParse({
        data: [{ code: '500', message: 'Server error' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts missing data field', () => {
      const result = JumiaApiErrorSchema.safeParse({ code: 'ERROR' });
      expect(result.success).toBe(true);
    });
  });

  describe('JumiaTokenErrorSchema', () => {
    it('parses a token endpoint error', () => {
      const error = {
        error: 'invalid_grant',
        error_description: 'Refresh token has expired',
      };
      const result = JumiaTokenErrorSchema.safeParse(error);
      expect(result.success).toBe(true);
    });

    it('rejects object missing the error field', () => {
      const result = JumiaTokenErrorSchema.safeParse({
        error_description: 'Refresh token has expired',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaConsignmentCreateResponseSchema', () => {
    it('parses a valid consignment create response', () => {
      const result = JumiaConsignmentCreateResponseSchema.safeParse({
        purchaseOrderNumber: 'PO-2026-001',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing purchaseOrderNumber', () => {
      const result = JumiaConsignmentCreateResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('JumiaConsignmentStockResponseSchema', () => {
    it('parses a valid consignment stock response', () => {
      const result = JumiaConsignmentStockResponseSchema.safeParse({
        simpleSku: 'SKU-123',
        received: 100,
        quarantined: 5,
        defective: 2,
        canceled: 0,
        returned: 3,
        failed: 1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-numeric stock fields', () => {
      const result = JumiaConsignmentStockResponseSchema.safeParse({
        simpleSku: 'SKU-123',
        received: 'not-a-number',
        quarantined: 5,
        defective: 2,
        canceled: 0,
        returned: 3,
        failed: 1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing simpleSku', () => {
      const result = JumiaConsignmentStockResponseSchema.safeParse({
        received: 100,
        quarantined: 5,
        defective: 2,
        canceled: 0,
        returned: 3,
        failed: 1,
      });
      expect(result.success).toBe(false);
    });
  });
});
