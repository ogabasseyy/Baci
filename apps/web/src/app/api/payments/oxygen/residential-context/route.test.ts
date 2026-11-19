import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/payments/oxygen/draft-store', () => ({
  readOxygenResidentialDraft: vi.fn(async () => ({})),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));

import { GET } from './route';

const workflowId = '690a9d2e-33b7-4106-8c68-b9019f814dce';
const request = () =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/residential-context?workflowId=${workflowId}`
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'owner' },
    supabase: { from: mocks.from },
  });
});
function query(data: unknown, error: unknown = null) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  return q;
}
it('authenticates before any read', async () => {
  mocks.auth.mockResolvedValue({ error: 'Unauthorized' });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('does not read an order when the workflow is not owned', async () => {
  mocks.from.mockReturnValue(query(null));
  expect((await GET(request())).status).toBe(404);
  expect(mocks.from).toHaveBeenCalledTimes(1);
});
it('scopes the order to its workflow and excludes pickup addresses', async () => {
  const workflow = query({
    order_id: 'order',
    merchant_id: 'merchant',
    customer_id: 'customer',
  });
  const order = query({
    delivery_method: 'pickup_station',
    shipping_address: { address: 'Merchant office' },
  });
  mocks.from.mockReturnValueOnce(workflow).mockReturnValueOnce(order);
  const response = await GET(request());
  expect(await response.json()).toEqual({ address: {}, source: 'checkout' });
  expect(order.eq.mock.calls).toEqual([
    ['id', 'order'],
    ['merchant_id', 'merchant'],
    ['customer_id', 'customer'],
  ]);
});
it('only returns a safe editable address projection for door delivery', async () => {
  mocks.from
    .mockReturnValueOnce(
      query({ order_id: 'o', merchant_id: 'm', customer_id: 'c' })
    )
    .mockReturnValueOnce(
      query({
        delivery_method: 'door',
        shipping_address: { address: 'Example Road', phone: 'private' },
      })
    );
  const body = await (await GET(request())).json();
  expect(body.address.street).toBe('Example Road');
  expect(body.address).not.toHaveProperty('phone');
});
