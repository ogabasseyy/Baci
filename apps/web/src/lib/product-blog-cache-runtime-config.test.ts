import { afterEach, describe, expect, it } from 'vitest';
import { getProductBlogCacheRuntimeConfig } from './product-blog-cache-runtime-config';

const originalWorkerBaseUrl = process.env.BACI_WEB_BASE_URL;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalInternalSecret = process.env.INTERNAL_API_SECRET;

afterEach(() => {
  if (originalWorkerBaseUrl === undefined) delete process.env.BACI_WEB_BASE_URL;
  else process.env.BACI_WEB_BASE_URL = originalWorkerBaseUrl;
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  if (originalInternalSecret === undefined)
    delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalInternalSecret;
});

describe('getProductBlogCacheRuntimeConfig', () => {
  it('prefers the worker origin and trims the internal secret', () => {
    // Arrange
    process.env.BACI_WEB_BASE_URL = ' https://ogabassey.com/ ';
    process.env.NEXT_PUBLIC_APP_URL = 'https://fallback.example';
    process.env.INTERNAL_API_SECRET = ' internal-secret ';

    // Act
    const result = getProductBlogCacheRuntimeConfig();

    // Assert
    expect(result).toEqual({
      baseUrl: 'https://ogabassey.com/',
      secret: 'internal-secret',
    });
  });

  it('uses the public app origin and localhost fallback when worker config is absent', () => {
    // Arrange
    delete process.env.BACI_WEB_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = ' https://app.usebaci.com ';
    delete process.env.INTERNAL_API_SECRET;

    // Act
    const result = getProductBlogCacheRuntimeConfig();

    // Assert
    expect(result).toEqual({
      baseUrl: 'https://app.usebaci.com',
      secret: undefined,
    });

    // Arrange
    delete process.env.NEXT_PUBLIC_APP_URL;

    // Act
    const localhostResult = getProductBlogCacheRuntimeConfig();

    // Assert
    expect(localhostResult.baseUrl).toBe('http://localhost:3000');
  });
});
