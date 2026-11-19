import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { retrievedProduct } from '@/schemas/jumia/catalog-products.test-fixtures';
import { getAllProducts, getProducts } from './catalog';
import { JumiaClient } from './client';
import { resetJumiaRateLimiterForTests } from './jumia-rate-limiter';

function client() {
  return new JumiaClient({
    integrationId: 'synthetic-integration',
    merchantId: 'synthetic-merchant',
    shopId: retrievedProduct.shop.id,
    marketplaceKey: 'jumia-ng',
    accessToken: 'synthetic-access-token',
    refreshToken: 'synthetic-refresh-token',
    clientId: 'synthetic-client',
    tokenExpiresAt: new Date('2099-01-01T00:00:00Z'),
    environment: 'staging',
  });
}

function page(
  nextToken: string | null,
  isLastPage = false,
  products = [retrievedProduct]
) {
  return Response.json({ products, nextToken, isLastPage });
}

describe('Retrieve Products through real helper, HTTP client and schema', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let responses: Array<Response | Error>;

  beforeEach(() => {
    responses = [];
    fetchMock.mockReset().mockImplementation(async () => {
      // Keep this HTTP contract test fast without mocking client/schema logic.
      resetJumiaRateLimiterForTests();
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Unexpected extra provider request');
      return response;
    });
    resetJumiaRateLimiterForTests();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetJumiaRateLimiterForTests();
  });

  it('keeps the single-page helper resumable and encodes opaque cursor and scalar SKU', async () => {
    responses.push(page('next/+&= token'));
    const result = await getProducts(client(), {
      nextToken: 'resume/+&= token',
      sellerSku: ' SKU/+&=? Exact ',
      shopId: retrievedProduct.shop.id,
      status: 'ACTIVE',
    });
    expect(result).toEqual({
      products: [retrievedProduct],
      nextToken: 'next/+&= token',
      isLastPage: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://vendor-api-staging.jumia.com/catalog/products?token=resume%2F%2B%26%3D+token&status=ACTIVE&shopId=a8b5534b-277b-449c-97b7-c00979dd9c3a&sellerSku=+SKU%2F%2B%26%3D%3F+Exact+'
    );
  });

  it.each([
    'active',
    'inactive',
    'ACTIVE',
    'INACTIVE',
  ])('normalizes supported legacy status %s and preserves every filter on each page', async (status) => {
    responses.push(page('cursor/+&='), page(null, true, []));
    expect(
      await getAllProducts(client(), {
        status,
        shopId: retrievedProduct.shop.id,
        sellerSku: 'Exact/+ SKU',
      })
    ).toEqual([retrievedProduct]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    for (const url of urls) {
      expect(url.searchParams.get('status')).toBe(status.toUpperCase());
      expect(url.searchParams.get('shopId')).toBe(retrievedProduct.shop.id);
      expect(url.searchParams.get('sellerSku')).toBe('Exact/+ SKU');
      expect(url.searchParams.has('nextToken')).toBe(false);
    }
    expect(urls[0].searchParams.has('token')).toBe(false);
    expect(urls[1].searchParams.get('token')).toBe('cursor/+&=');
  });

  it('accepts populated terminal pages without following their unused cursor', async () => {
    responses.push(page('unused-token', true));
    expect(await getAllProducts(client())).toEqual([retrievedProduct]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts an empty terminal first page', async () => {
    responses.push(page(null, true, []));
    expect(await getAllProducts(client())).toEqual([]);
  });

  it.each([
    null,
    '',
  ])('rejects missing continuation %j instead of returning partial success', async (token) => {
    responses.push(page(token));
    await expect(getAllProducts(client())).rejects.toThrow(/no nextToken/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['same', 'same'],
    ['first', 'second', 'first'],
  ])('rejects repeated or cyclic continuation %j before another request', async (...tokens) => {
    responses.push(...tokens.map((token) => page(token)));
    await expect(getAllProducts(client())).rejects.toThrow(
      /repeated nextToken/
    );
    expect(fetchMock).toHaveBeenCalledTimes(tokens.length);
  });

  it('bounds unique continuation chains without returning partial data', async () => {
    for (let index = 0; index < 1000; index++)
      responses.push(page(`cursor-${index}`, false, []));
    await expect(getAllProducts(client())).rejects.toThrow(
      /exceeded 1000 pages/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1000);
  });

  it.each([
    { products: [{}], nextToken: null, isLastPage: true },
    {
      products: [
        {
          ...retrievedProduct,
          variations: [
            { ...retrievedProduct.variations[0], sellerSku: undefined },
          ],
        },
      ],
      nextToken: null,
      isLastPage: true,
    },
    { products: [], nextToken: null },
    { products: [], isLastPage: false },
  ])('rejects malformed data after a valid page %j', async (invalid) => {
    responses.push(page('next'), Response.json(invalid));
    await expect(getAllProducts(client())).rejects.toBeInstanceOf(ZodError);
  });

  it.each([
    new Error('Network failed'),
    new Response('Provider unavailable', { status: 503 }),
  ])('propagates provider/network failure after a valid page', async (failure) => {
    responses.push(page('next'), failure);
    await expect(getAllProducts(client())).rejects.toThrow(
      /Network failed|Provider unavailable/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
