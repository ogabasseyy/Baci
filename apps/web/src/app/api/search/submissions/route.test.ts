import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logger,
  merchantId,
  submissionMocks as mocks,
  POST,
  request,
  SearchSubmissionValidationError,
  setupSubmissionMocks,
} from './route.test-helpers';

describe('explicit search submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmissionMocks();
  });

  it.each([
    'navbar',
    'results-form',
    'did-you-mean',
    'popular-search',
  ])('records %s with a server-derived count and host-derived merchant', async (source) => {
    const response = await POST(
      request({ query: ' iphone ', pathPrefix: '/other-merchant', source })
    );
    expect(response.status).toBe(204);
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey.com');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        merchant_id_param: merchantId,
        search_query: 'iphone',
        result_limit: 1,
      })
    );
    expect(mocks.recordSubmission).toHaveBeenCalledExactlyOnceWith({
      merchant_id: merchantId,
      search_query: 'iphone',
      results_count: 27,
      search_method: 'client',
    });
  });

  it('logs ingestion validation failures distinctly from downtime', async () => {
    mocks.recordSubmission.mockRejectedValueOnce(
      new SearchSubmissionValidationError()
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({
      message: 'Search submission row failed ingestion validation',
      errorName: 'SearchSubmissionValidationError',
    });
  });

  it('logs transport and config failures as infrastructure, not validation', async () => {
    const failure = new Error('service role is not configured');
    failure.name = 'ServiceClientConfigError';
    mocks.recordSubmission.mockRejectedValueOnce(failure);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({
      message: 'Search submission ingestion infrastructure failure',
      errorName: 'ServiceClientConfigError',
    });
  });

  it('logs DB insert errors with a secret-free classification', async () => {
    mocks.recordSubmission.mockResolvedValueOnce({
      error: { code: 'XX000', message: 'db down' },
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({
      message: 'Search submissions insert failed',
      errorCode: 'XX000',
    });
  });

  it('falls back to unknown when the error has no code', async () => {
    mocks.recordSubmission.mockResolvedValueOnce({
      error: { message: 'fetch failed' },
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({
      message: 'Search submissions insert failed',
      errorCode: 'unknown',
    });
  });

  it('writes through the narrow ingestion edge so direct writes stay revoked', async () => {
    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(mocks.recordSubmission).toHaveBeenCalledExactlyOnceWith({
      merchant_id: merchantId,
      search_query: 'iphone',
      results_count: 27,
      search_method: 'client',
    });
    expect(mocks.cookieFrom).not.toHaveBeenCalledWith('search_analytics');
    expect(mocks.cookieInsert).not.toHaveBeenCalled();
  });

  it('resolves path-based stores on the platform domain', async () => {
    await POST(
      request(
        { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
        {},
        'https://usebaci.com/api/search/submissions'
      )
    );
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey');
  });

  it.each([
    ['https://ogabassey.usebaci.com', 'ogabassey'],
    ['http://ogabassey.localhost:3000', 'ogabassey'],
    ['https://www.ogabassey.com', 'ogabassey.com'],
  ])('resolves the storefront identity from %s', async (origin, identifier) => {
    await POST(
      request(
        { query: 'phone', pathPrefix: '/other-store', source: 'navbar' },
        {},
        `${origin}/api/search/submissions`
      )
    );
    expect(mocks.merchant).toHaveBeenCalledWith(identifier);
  });

  it.each([
    'https://www.usebaci.com',
    'https://baci-preview.vercel.app',
    'http://localhost:3000',
  ])('resolves path-based stores on %s', async (origin) => {
    const response = await POST(
      request(
        { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
        {},
        `${origin}/api/search/submissions`
      )
    );
    expect(response.status).toBe(204);
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey');
  });

  it('falls back to the exact www hostname when only it is registered', async () => {
    mocks.merchant.mockImplementation(async (identifier: string) =>
      identifier === 'www.shop.example.com'
        ? { id: merchantId, slug: 'shop' }
        : null
    );
    const response = await POST(
      request(
        { query: 'phone', pathPrefix: '', source: 'navbar' },
        {},
        'https://www.shop.example.com/api/search/submissions'
      )
    );
    expect(response.status).toBe(204);
    expect(mocks.merchant).toHaveBeenCalledWith('shop.example.com');
    expect(mocks.merchant).toHaveBeenCalledWith('www.shop.example.com');
    expect(mocks.recordSubmission).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ merchant_id: merchantId })
    );
  });

  it('does not accept a merchant supplied from a reserved platform subdomain', async () => {
    const response = await POST(
      request(
        { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
        {},
        'https://app.usebaci.com/api/search/submissions'
      )
    );
    expect(response.status).toBe(404);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('records zero-result submissions without a spelling lookup', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await POST(request())).status).toBe(204);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ results_count: 0 })
    );
  });

  it('does not write for an unknown storefront', async () => {
    mocks.merchant.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    'search',
    'insert',
    'throw',
  ])('returns a safe failure when %s fails', async (failure) => {
    if (failure === 'search')
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: 'secret database detail' },
      });
    if (failure === 'insert')
      mocks.recordSubmission.mockResolvedValue({
        error: { message: 'secret database detail' },
      });
    if (failure === 'throw')
      mocks.recordSubmission.mockRejectedValue(
        new Error('secret database detail')
      );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Search tracking unavailable',
    });
    if (failure === 'search')
      expect(mocks.recordSubmission).not.toHaveBeenCalled();
  });
});
