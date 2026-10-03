import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProductRequestSubmitError,
  submitProductRequest,
} from './product-request';

const request = {
  query: 'iPhone 20',
  contact: 'shopper@example.com',
  merchantSlug: 'ogabassey',
  requestId: '11111111-1111-4111-8111-111111111111',
};
const endpoint = 'https://example.com/api/storefront/product-requests';
function jsonResponse(status: number) {
  return new Response(JSON.stringify({}), { status });
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(200))
  );
});
describe('product request intake', () => {
  it('submits validated contact and an idempotency ID to the gated intake API', async () => {
    await submitProductRequest(endpoint, request);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(request);
  });
  it('rejects missing contact and punctuation-only products before a write', async () => {
    await expect(
      submitProductRequest(endpoint, { ...request, contact: '' })
    ).rejects.toThrow();
    await expect(
      submitProductRequest(endpoint, { ...request, query: '!!!' })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects digit-less phone strings but accepts real phone numbers', async () => {
    for (const contact of ['-------', '(((((((', '(   ) --']) {
      await expect(
        submitProductRequest(endpoint, { ...request, contact })
      ).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    await submitProductRequest(endpoint, {
      ...request,
      contact: '+234 801 234 5678',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('surfaces rate limiting distinctly and hides other failure details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(429));
    const limited = await submitProductRequest(endpoint, request).then(
      () => null,
      (error: unknown) => error
    );
    expect(limited).toBeInstanceOf(ProductRequestSubmitError);
    expect((limited as ProductRequestSubmitError).status).toBe(429);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500));
    await expect(submitProductRequest(endpoint, request)).rejects.toThrow(
      'Couldn’t send your request. Please try again.'
    );
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    await expect(submitProductRequest(endpoint, request)).rejects.toThrow(
      'Couldn’t send your request. Please try again.'
    );
  });
});
