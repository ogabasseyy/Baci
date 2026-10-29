import { jsonResponse } from './gigl.test-helpers';

/** HTTP fixture for quote tests focused on pricing/auth rather than coverage. */
export function mockGiglFetchWithCoverage(
  url: string,
  options?: RequestInit & { timeout?: number }
): Promise<Response> {
  if (url.endsWith('/lga/validateAddress')) {
    return Promise.resolve(
      jsonResponse({
        status: '200',
        data: { HomeDeliveryStatus: true },
      })
    );
  }
  return fetch(url, options);
}
