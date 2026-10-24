import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  getAllCategories,
  getAttributeSet,
  getCategories,
} from '@/lib/jumia/catalog';
import { JumiaClient } from '@/lib/jumia/client';
import { resetJumiaRateLimiterForTests } from '@/lib/jumia/jumia-rate-limiter';
import {
  documentedAttributes,
  documentedCategories,
} from '@/schemas/jumia/catalog.test-fixtures.json';

// Only the network boundary is mocked: helpers, client.request and schemas are real.
function createClient() {
  return new JumiaClient({
    integrationId: 'catalog-test-integration',
    merchantId: 'catalog-test-merchant',
    shopId: 'catalog-test-shop',
    marketplaceKey: 'jumia-ng',
    accessToken: 'synthetic-access-token',
    refreshToken: 'synthetic-unused-refresh-token',
    clientId: 'synthetic-client-id',
    tokenExpiresAt: new Date('2099-01-01T00:00:00Z'),
    environment: 'staging',
  });
}

describe('Jumia catalog HTTP response validation', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetJumiaRateLimiterForTests();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetJumiaRateLimiterForTests();
  });

  it('parses documented categories through the real client and helper', async () => {
    fetchMock.mockResolvedValue(Response.json(documentedCategories));
    expect(await getCategories(createClient(), { page: 1 })).toEqual(
      documentedCategories
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vendor-api-staging.jumia.com/catalog/categories?page=1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('parses documented attributes through the real client and helper', async () => {
    fetchMock.mockResolvedValue(Response.json(documentedAttributes));
    expect(
      await getAttributeSet(
        createClient(),
        documentedCategories.categories[0].attributeSet.sid
      )
    ).toEqual(documentedAttributes);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vendor-api-staging.jumia.com/catalog/attribute-sets/9b66c50c-562a-4a98-9eae-0cf133a50f9d',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it.each([
    { categories: [] },
    {
      ...documentedCategories,
      categories: [
        { ...documentedCategories.categories[0], hasChildren: undefined },
      ],
    },
  ])('fails closed on malformed categories instead of returning an empty list: %j', async (payload) => {
    fetchMock.mockResolvedValue(Response.json(payload));
    await expect(getAllCategories(createClient())).rejects.toBeInstanceOf(
      ZodError
    );
  });

  it.each([
    { attributeSet: { attributes: [] } },
    { attributes: [{ ...documentedAttributes.attributes[0], type: 9 }] },
    {
      attributes: [{ ...documentedAttributes.attributes[0], validations: [] }],
    },
  ])('fails closed on malformed attributes: %j', async (payload) => {
    fetchMock.mockResolvedValue(Response.json(payload));
    await expect(
      getAttributeSet(createClient(), 'test-set')
    ).rejects.toBeInstanceOf(ZodError);
  });

  it.each([
    'categories',
    'attributes',
  ])('preserves %s provider error responses', async (resource) => {
    fetchMock.mockResolvedValue(
      new Response('Provider unavailable', { status: 503 })
    );
    const request =
      resource === 'categories'
        ? getCategories(createClient())
        : getAttributeSet(createClient(), 'test-set');
    await expect(request).rejects.toMatchObject({
      name: 'JumiaApiError',
      status: 503,
      message: 'Jumia API Error (503): Provider unavailable',
      details: 'Provider unavailable',
    });
  });
});
