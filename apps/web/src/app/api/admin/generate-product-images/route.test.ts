import { beforeEach, describe, expect, it } from 'vitest';
import {
  getProductImageRouteMocks,
  mockProductImageTables,
  productImageRequest,
  resetProductImageRouteMocks,
} from './route.test-helpers';

const productImageRouteMocks = getProductImageRouteMocks();
const { POST } = await import('./route');

describe('POST /api/admin/generate-product-images access controls', () => {
  beforeEach(resetProductImageRouteMocks);

  it('authenticates before rejecting invalid CSRF tokens', async () => {
    productImageRouteMocks.checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: null,
    });

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'CSRF validation failed' });
    expect(productImageRouteMocks.getUser).toHaveBeenCalledOnce();
    expect(
      productImageRouteMocks.getUser.mock.invocationCallOrder[0]
    ).toBeLessThan(
      productImageRouteMocks.checkCsrfProtection.mock.invocationCallOrder[0]
    );
    expect(productImageRouteMocks.rpc).not.toHaveBeenCalled();
    expect(productImageRouteMocks.from).not.toHaveBeenCalled();
  });

  it('returns 401 when the user is not authenticated', async () => {
    productImageRouteMocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(
      productImageRouteMocks.getMerchantForApiRequest
    ).not.toHaveBeenCalled();
  });

  it('rejects staff members even when they belong to a merchant', async () => {
    productImageRouteMocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      staffAccess: { isStaff: true },
    });

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Permission denied' });
    expect(productImageRouteMocks.from).not.toHaveBeenCalled();
  });

  it('requires the content management platform permission', async () => {
    productImageRouteMocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(productImageRouteMocks.checkRateLimit).not.toHaveBeenCalled();
    expect(
      productImageRouteMocks.getMerchantForApiRequest
    ).not.toHaveBeenCalled();
  });

  it('enforces the per-user AI image generation rate limit', async () => {
    mockProductImageTables();
    productImageRouteMocks.checkRateLimit.mockResolvedValue(false);

    const response = await POST(productImageRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Rate limit exceeded',
      code: 'rate_limited',
    });
    expect(productImageRouteMocks.generateText).not.toHaveBeenCalled();
  });
});
