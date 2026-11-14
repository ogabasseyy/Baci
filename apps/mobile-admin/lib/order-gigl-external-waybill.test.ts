import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  createAuthenticatedFetchText: async (...args: unknown[]) => {
    const response: Response = await fetchMock(...args);
    return { response, text: await response.text() };
  },
}));
vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://example.test' }));

import {
  GiglExternalWaybillError,
  linkOrderGiglExternalWaybill,
  previewOrderGiglExternalWaybill,
} from './order-gigl-external-waybill';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

const preview = {
  waybill: '1349639588',
  linkable: true,
  match: { name: 'match', phone: 'match', destination: 'match' },
  order: { customerName: 'Audu Emmanuel', orderNumber: 'ORD-1' },
  gig: null,
};

describe('order GIG external waybill API', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('asks the order route to preview the waybill', async () => {
    fetchMock.mockResolvedValue(response({ preview }));

    await expect(
      previewOrderGiglExternalWaybill('order 1', '1349639588')
    ).resolves.toEqual(preview);

    const [url, init, timeout] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://example.test/api/orders/order%201/shipping/gigl-waybill'
    );
    expect(JSON.parse(init.body)).toEqual({
      action: 'preview',
      waybill: '1349639588',
    });
    expect(init.method).toBe('POST');
    expect(timeout).toBe(45_000);
  });

  it('links the waybill and returns the shipment', async () => {
    fetchMock.mockResolvedValue(
      response({
        success: true,
        shipmentId: 'shipment-1',
        trackingNumber: '1349639588',
        preview,
      })
    );

    await expect(
      linkOrderGiglExternalWaybill('order-1', '1349639588')
    ).resolves.toEqual({
      success: true,
      shipmentId: 'shipment-1',
      trackingNumber: '1349639588',
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).action).toBe('link');
  });

  it('surfaces the server message and code', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: 'This waybill is already attached to another order.',
          code: 'WAYBILL_ALREADY_LINKED',
        },
        409
      )
    );

    const error = await linkOrderGiglExternalWaybill('order-1', '1').catch(
      (cause: unknown) => cause
    );
    expect(error).toBeInstanceOf(GiglExternalWaybillError);
    expect(error).toMatchObject({
      code: 'WAYBILL_ALREADY_LINKED',
      message: 'This waybill is already attached to another order.',
      status: 409,
    });
  });

  it('rejects an unexpected response shape', async () => {
    fetchMock.mockResolvedValue(response({ preview: { waybill: 1 } }));
    await expect(
      previewOrderGiglExternalWaybill('order-1', '1349639588')
    ).rejects.toThrow('Invalid server response');
  });
});
