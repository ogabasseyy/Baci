import { beforeEach, describe, expect, it } from 'vitest';
import {
  getProductImageRouteMocks,
  merchantId,
  mockProductImageTables,
  parentProductId,
  productImageRequest,
  resetProductImageRouteMocks,
} from './route.test-helpers';

const productImageRouteMocks = getProductImageRouteMocks();
const { POST } = await import('./route');

describe('POST /api/admin/generate-product-images batches', () => {
  beforeEach(resetProductImageRouteMocks);

  it('generates and appends an image for eligible parent variants', async () => {
    const { productsQuery, productsTable } = mockProductImageTables({
      products: [
        {
          category: 'Phones',
          color: 'blue',
          id: 'product-1',
          images: [],
          name: 'Baci Phone',
          parent_product_id: parentProductId,
          slug: 'baci-phone',
        },
      ],
    });

    const response = await POST(
      productImageRequest(
        `https://usebaci.com/api/admin/generate-product-images?parent_product_id=${parentProductId}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      errors: [],
      processed: [
        {
          id: 'product-1',
          name: 'Baci Phone',
          new_image: 'https://cdn.usebaci.com/product-1/gen.png',
        },
      ],
      processed_count: 1,
      success: true,
    });
    expect(productsQuery.eq).toHaveBeenCalledWith(
      'parent_product_id',
      parentProductId
    );
    expect(productImageRouteMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-image-model',
        providerOptions: { google: { responseModalities: ['IMAGE'] } },
      })
    );
    expect(productImageRouteMocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^product-1\/gen_\d+\.png$/),
      expect.any(Buffer),
      { contentType: 'image/png', upsert: false }
    );
    expect(productsTable.update).toHaveBeenCalledWith({
      images: ['https://cdn.usebaci.com/product-1/gen.png'],
    });
    expect(productImageRouteMocks.revalidateProducts).toHaveBeenCalledWith(
      merchantId,
      undefined,
      { feedScope: 'merchant' }
    );
    expect(productImageRouteMocks.revalidateProductSlugs).toHaveBeenCalledWith(
      merchantId,
      ['baci-phone']
    );
  });

  it('returns a no-op message when no products are eligible', async () => {
    mockProductImageTables({
      products: [
        {
          color: null,
          id: 'product-1',
          images: ['1.png', '2.png', '3.png', '4.png'],
          name: 'Complete Gallery',
          parent_product_id: null,
        },
      ],
    });

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'No eligible products found needing images.',
    });
    expect(productImageRouteMocks.generateText).not.toHaveBeenCalled();
  });

  it('returns a stable error when the products query fails', async () => {
    mockProductImageTables({
      productsError: { message: 'products query failed' },
    });

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'product_images_unavailable',
      error: 'Unable to load products for image generation.',
    });
    expect(body.error).not.toContain('products query failed');
    expect(productImageRouteMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { message: 'products query failed' },
        message: 'Product image query failed',
      })
    );
    expect(productImageRouteMocks.generateText).not.toHaveBeenCalled();
  });

  it('fails the batch when every attempted product generation fails', async () => {
    mockProductImageTables({
      products: [
        {
          color: 'blue',
          id: 'product-1',
          images: [],
          name: 'Baci Phone',
          parent_product_id: parentProductId,
          slug: 'baci-phone',
        },
      ],
    });
    productImageRouteMocks.generateText.mockRejectedValue({
      message: 'Gemini provider rejected the request',
    });

    const response = await POST(
      productImageRequest(
        `https://usebaci.com/api/admin/generate-product-images?parent_product_id=${parentProductId}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: 'product_image_generation_failed',
      error: 'Unable to generate images for the selected products.',
      errors: [{ code: 'image_generation_failed', id: 'product-1' }],
      processed: [],
      processed_count: 0,
      success: false,
    });
    expect(JSON.stringify(body)).not.toContain('Gemini provider');
    expect(productImageRouteMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Product image generation failed',
        productId: 'product-1',
      })
    );
  });
});
