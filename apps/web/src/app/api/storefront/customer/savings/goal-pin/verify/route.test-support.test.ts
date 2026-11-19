import { expect, it, vi } from 'vitest';
import { call, fund } from './route.test-support';

vi.mock('./route', () => ({
  POST: vi.fn(async (request: Request) => Response.json({ url: request.url })),
}));

it('call() posts the JSON body to the verify URL', async () => {
  const response = await call(fund);
  const payload = await response.json();
  expect(payload.url).toBe(
    'https://example.com/api/storefront/customer/savings/goal-pin/verify'
  );
  const { POST } = await import('./route');
  const request = vi.mocked(POST).mock.calls[0]?.[0];
  expect(request?.method).toBe('POST');
  expect(await request?.json()).toEqual(fund);
});
