import { describe, expect, it, vi } from 'vitest';
import { createPetrockClient } from './petrock-client';

function setup(payload: unknown, httpStatus = 200) {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(payload), { status: httpStatus })
    );
  return {
    fetchImpl,
    client: createPetrockClient({
      baseUrl: 'https://api.petrock.biz/api/reseller/v1',
      token: 'test-token',
      fetchImpl,
    }),
  };
}

const submission = {
  feedbackUrl: 'https://shop.example/feedback/token',
  identifier: '490154203237518',
  orderFieldName: 'IMEI',
  productId: '1955',
  referenceId: 'lookup-123',
};

describe('documented DHRU reseller contract', () => {
  it('sends numeric catalog IDs as product_id rather than product_uuid', async () => {
    const { client, fetchImpl } = setup({
      status: 'success',
      code: 200,
      data: [[{ order_uuid: 'D123', reference_id: 'lookup-123' }]],
    });
    await client.submitOrder(submission);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body[0].product_id).toBe(1955);
    expect(body[0]).not.toHaveProperty('product_uuid');
  });

  it('keeps UUID product identifiers in product_uuid', async () => {
    const { client, fetchImpl } = setup({ data: [[{ order_uuid: 'D123' }]] });
    await client.submitOrder({
      ...submission,
      productId: '550e8400-e29b-41d4-a716-446655440000',
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body[0].product_uuid).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(body[0]).not.toHaveProperty('product_id');
  });

  it('uses the requested UUID when single-order data omits its identity', async () => {
    const { client } = setup({
      status: 'success',
      code: 200,
      data: { quantity: 1, replay: 'Model: iPhone', status: 'success' },
    });
    await expect(client.getOrder('D123')).resolves.toMatchObject({
      ok: true,
      data: { orderUuid: 'D123', status: 'success' },
    });
  });

  it.each([
    'pre-checking',
    'accepted',
    'pending',
    'verify',
  ])('keeps the documented %s order state pending', async (status) => {
    const { client } = setup({
      status: 'success',
      code: 200,
      data: { status },
    });
    await expect(client.getOrder('D123')).resolves.toMatchObject({
      ok: true,
      data: { status: 'in-process', orderUuid: 'D123' },
    });
  });

  it('normalizes the documented rejected state for existing refund flows', async () => {
    const { client } = setup({
      status: 'success',
      code: 200,
      data: { status: 'rejected', replay: 'Rejected by supplier' },
    });
    await expect(client.getOrder('D123')).resolves.toMatchObject({
      ok: true,
      data: { status: 'reject' },
    });
  });

  it('rejects an order identity that conflicts with the requested order', async () => {
    const { client } = setup({
      data: { order_uuid: 'OTHER', status: 'success' },
    });
    await expect(client.getOrder('D123')).resolves.toMatchObject({ ok: false });
  });

  it('does not accept HTTP 201 status:error as a successful submission', async () => {
    const { client, fetchImpl } = setup(
      { status: 'error', code: 201, data: [[{ order_uuid: 'D123' }]] },
      201
    );
    await expect(client.submitOrder(submission)).resolves.toMatchObject({
      ok: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not release a successful order nested in an error envelope', async () => {
    const { client } = setup(
      {
        status: 'error',
        code: 201,
        data: {
          order_uuid: 'D123',
          status: 'success',
          replay: 'Model: iPhone',
        },
      },
      201
    );
    await expect(client.getOrder('D123')).resolves.toMatchObject({ ok: false });
  });

  it.each([
    undefined,
    null,
    {},
    '',
  ])('rejects missing or invalid submission order IDs (%s)', async (order_uuid) => {
    const { client } = setup({ status: 'success', data: [[{ order_uuid }]] });
    await expect(client.submitOrder(submission)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects a conflicting submission reference', async () => {
    const { client } = setup({
      data: [[{ order_uuid: 'D123', reference_id: 'OTHER' }]],
    });
    await expect(client.submitOrder(submission)).resolves.toMatchObject({
      ok: false,
    });
  });
});
