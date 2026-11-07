import { beforeEach, expect, it, vi } from 'vitest';
import {
  buildGetRequest,
  GET,
  getMocks,
  mockProvenCustomer,
  ORDER_ID,
  SESSION_USER_ID,
} from './route.test-helpers';

beforeEach(() => {
  vi.clearAllMocks();
  mockProvenCustomer();
  getMocks().distributedRateLimit.mockResolvedValue({ allowed: true });
});

it('uses the authenticated identity in the distributed availability bucket before reads', async () => {
  const { client } = mockProvenCustomer();
  getMocks().distributedRateLimit.mockResolvedValueOnce({ allowed: false });
  expect((await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).status).toBe(429);
  expect(getMocks().distributedRateLimit).toHaveBeenCalledWith(
    SESSION_USER_ID,
    'availability',
    10
  );
  expect(client.from).not.toHaveBeenCalled();
});

it('fails closed on a distributed limiter error without exposing it', async () => {
  const { client } = mockProvenCustomer();
  getMocks().distributedRateLimit.mockRejectedValueOnce(
    new Error('private limiter error')
  );
  const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private limiter error');
  expect(client.from).not.toHaveBeenCalled();
});

it('uses separate authenticated identities rather than request headers', async () => {
  const { client } = mockProvenCustomer();
  await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
  getMocks().authenticateApiRequest.mockResolvedValueOnce({
    user: { id: 'different-user' },
    supabase: client,
  });
  await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
  expect(getMocks().distributedRateLimit).toHaveBeenNthCalledWith(
    1,
    SESSION_USER_ID,
    'availability',
    10
  );
  expect(getMocks().distributedRateLimit).toHaveBeenNthCalledWith(
    2,
    'different-user',
    'availability',
    10
  );
});
