import { describe, expect, it, vi } from 'vitest';
import type { JumiaClient } from '@/lib/jumia/client';
import {
  getAllOrders,
  getOrderItems,
  getOrders,
  getShipmentProviders,
  MAX_PAGES,
} from '@/lib/jumia/orders';
import {
  JumiaOrderItemsResponseSchema,
  JumiaOrdersResponseSchema,
  JumiaShipmentProvidersResponseSchema,
} from '@/schemas/jumia';

function createMockClient(response: unknown): JumiaClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as JumiaClient;
}

/** Extract the path argument from the Nth call (0-indexed) to client.request. */
function getMockCalledPath(client: JumiaClient, callIndex = 0): string {
  return (client.request as ReturnType<typeof vi.fn>).mock.calls[
    callIndex
  ][1] as string;
}

describe('getOrders', () => {
  it('calls GET /orders and returns orders, nextToken, isLastPage', async () => {
    const mockResponse = {
      orders: [{ orderId: 'ORD-1', status: 'pending' }],
      nextToken: 'abc123',
      isLastPage: false,
    };
    const client = createMockClient(mockResponse);

    const result = await getOrders(client);

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/orders',
      JumiaOrdersResponseSchema
    );
    expect(result).toEqual({
      orders: [{ orderId: 'ORD-1', status: 'pending' }],
      nextToken: 'abc123',
      isLastPage: false,
    });
  });

  it('passes status, createdAfter, and nextToken as query params', async () => {
    const mockResponse = { orders: [], nextToken: undefined, isLastPage: true };
    const client = createMockClient(mockResponse);

    await getOrders(client, {
      status: 'shipped',
      createdAfter: '2026-01-01',
      nextToken: 'page2',
    });

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/orders?'),
      JumiaOrdersResponseSchema
    );

    const calledPath = getMockCalledPath(client);
    const url = new URL(`https://x${calledPath}`);
    expect(url.searchParams.get('status')).toBe('shipped');
    expect(url.searchParams.get('createdAfter')).toBe('2026-01-01');
    expect(url.searchParams.get('nextToken')).toBe('page2');
  });

  it('returns nextToken as null when response has no nextToken', async () => {
    const mockResponse = { orders: [], isLastPage: true };
    const client = createMockClient(mockResponse);

    const result = await getOrders(client);

    expect(result.nextToken).toBeNull();
    expect(result.isLastPage).toBe(true);
  });

  it('propagates errors when client.request rejects', async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error('Timeout')),
    } as unknown as JumiaClient;

    await expect(getOrders(client)).rejects.toThrow('Timeout');
  });
});

describe('getAllOrders', () => {
  it('auto-paginates across 2 pages', async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          orders: [{ orderId: 'ORD-1' }],
          nextToken: 'page2token',
          isLastPage: false,
        })
        .mockResolvedValueOnce({
          orders: [{ orderId: 'ORD-2' }],
          nextToken: undefined,
          isLastPage: true,
        }),
    } as unknown as JumiaClient;

    const result = await getAllOrders(client);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ orderId: 'ORD-1' });
    expect(result[1]).toEqual({ orderId: 'ORD-2' });
    expect(client.request).toHaveBeenCalledTimes(2);

    // Second call should include the nextToken from page 1
    const secondCallPath = getMockCalledPath(client, 1);
    expect(secondCallPath).toContain('nextToken=page2token');
  });

  it(`throws when exceeding MAX_PAGES (${MAX_PAGES}) to prevent infinite loops`, async () => {
    // Every page returns a nextToken and isLastPage: false, so pagination never ends
    const client = {
      request: vi.fn().mockImplementation(() =>
        Promise.resolve({
          orders: [{ orderId: 'ORD-X' }],
          nextToken: 'always-more',
          isLastPage: false,
        })
      ),
    } as unknown as JumiaClient;

    await expect(getAllOrders(client)).rejects.toThrow(
      `getAllOrders exceeded ${MAX_PAGES} pages`
    );

    expect(client.request).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it('preserves filter params across paginated calls', async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          orders: [{ orderId: 'ORD-1' }],
          nextToken: 'page2token',
          isLastPage: false,
        })
        .mockResolvedValueOnce({
          orders: [{ orderId: 'ORD-2' }],
          nextToken: undefined,
          isLastPage: true,
        }),
    } as unknown as JumiaClient;

    const result = await getAllOrders(client, {
      status: 'DELIVERED',
      createdAfter: '2023-01-01',
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ orderId: 'ORD-1' });
    expect(result[1]).toEqual({ orderId: 'ORD-2' });
    expect(client.request).toHaveBeenCalledTimes(2);

    // Second call should include the original filter params plus nextToken
    const secondCallPath = getMockCalledPath(client, 1);
    const url = new URL(`https://x${secondCallPath}`);
    expect(url.searchParams.get('status')).toBe('DELIVERED');
    expect(url.searchParams.get('createdAfter')).toBe('2023-01-01');
    expect(url.searchParams.get('nextToken')).toBe('page2token');
  });

  it('returns empty array when first page is empty', async () => {
    const mockResponse = { orders: [], nextToken: undefined, isLastPage: true };
    const client = createMockClient(mockResponse);

    const result = await getAllOrders(client);

    expect(result).toEqual([]);
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});

describe('getOrderItems', () => {
  it('calls GET /orders/items?orderId=... with encoded orderId', async () => {
    const mockResponse = { orderItems: [{ orderItemId: 'ITEM-1' }] };
    const client = createMockClient(mockResponse);

    const result = await getOrderItems(client, 'ORD-123/special');

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/orders/items?orderId=ORD-123%2Fspecial',
      JumiaOrderItemsResponseSchema
    );
    expect(result).toEqual(mockResponse);
  });

  it('propagates errors when client.request rejects', async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as JumiaClient;

    await expect(getOrderItems(client, 'ORD-1')).rejects.toThrow('Not found');
  });
});

describe('getShipmentProviders', () => {
  it('throws when orderItemIds array is empty', async () => {
    const client = createMockClient({});

    await expect(getShipmentProviders(client, [])).rejects.toThrow(
      'orderItemIds must contain at least one id'
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('propagates errors when client.request rejects', async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error('Service unavailable')),
    } as unknown as JumiaClient;

    await expect(getShipmentProviders(client, ['ITEM-1'])).rejects.toThrow(
      'Service unavailable'
    );
  });

  it('calls GET /orders/shipment-providers with repeated orderItemId params', async () => {
    const mockResponse = { shipmentProviders: [{ id: 'SP-1', name: 'DHL' }] };
    const client = createMockClient(mockResponse);

    const result = await getShipmentProviders(client, ['ITEM-1', 'ITEM-2']);

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/orders/shipment-providers?'),
      JumiaShipmentProvidersResponseSchema
    );

    const calledPath = getMockCalledPath(client);
    const url = new URL(`https://x${calledPath}`);
    expect(url.searchParams.getAll('orderItemId')).toEqual([
      'ITEM-1',
      'ITEM-2',
    ]);
    expect(result).toEqual(mockResponse);
  });
});
