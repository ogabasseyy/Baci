import { expect, it, vi } from 'vitest';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json({ status: 'test' });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const isCurrent = vi.fn(() => true);
  const getCsrfToken = vi.fn(async () => 'csrf');
  const request = createPiggyvestCustomerClientRequest({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPaths: ['/purchase/status'],
    },
    fetch,
    getCsrfToken,
    isCurrent,
  });
  return { fetch, isCurrent, getCsrfToken, request };
}
it('limits paths and request methods before HTTP', async () => {
  const test = fixture();
  await expect(
    test.request({ method: 'GET', endpointPath: '/elsewhere' })
  ).rejects.toThrow();
  expect(test.fetch).not.toHaveBeenCalled();
});
it('rejects redirects, URL mismatch and non-json responses', async () => {
  for (const kind of ['redirect', 'url', 'type']) {
    const test = fixture();
    test.fetch.mockImplementation(async (url) => {
      const response = new Response('{}', {
        headers: {
          'content-type': kind === 'type' ? 'text/html' : 'application/json',
        },
      });
      Object.defineProperty(response, 'url', {
        value: kind === 'url' ? 'http://127.0.0.1:3000/elsewhere' : String(url),
      });
      if (kind === 'redirect')
        Object.defineProperty(response, 'redirected', { value: true });
      return response;
    });
    await expect(
      test.request({ method: 'GET', endpointPath: '/purchase/status' })
    ).rejects.toThrow();
  }
});
it('bounds CSRF lookup and never dispatches when it times out', async () => {
  vi.useFakeTimers();
  try {
    const test = fixture();
    test.getCsrfToken.mockImplementation(() => new Promise(() => undefined));
    const result = expect(
      test.request({
        method: 'POST',
        endpointPath: '/purchase/status',
        body: {},
      })
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5001);
    await result;
    expect(test.fetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it('rejects an invalidated or aborted session before dispatch', async () => {
  const test = fixture();
  test.isCurrent.mockReturnValue(false);
  await expect(
    test.request({ method: 'GET', endpointPath: '/purchase/status' })
  ).rejects.toThrow();
  expect(test.fetch).not.toHaveBeenCalled();
});
