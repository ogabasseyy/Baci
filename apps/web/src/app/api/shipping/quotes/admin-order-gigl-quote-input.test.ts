import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { resolveAdminOrderGiglQuoteInput } from './admin-order-gigl-quote-input';

const ADMIN_ORDER_ID = '11111111-1111-4111-8111-111111111111';

function makeRequest(
  body: unknown,
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest('http://localhost:3000/api/shipping/quotes', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('resolveAdminOrderGiglQuoteInput', () => {
  it('returns validated input when admin_order_id and receiver are provided', async () => {
    const result = await resolveAdminOrderGiglQuoteInput(makeRequest({}), {
      admin_order_id: ADMIN_ORDER_ID,
      preview: true,
      receiver: {
        address: '12 Admiralty Way',
        city: 'Lagos',
        state: 'Lagos',
        phone: '+2348000000000',
      },
    });

    expect(result).toEqual({
      admin_order_id: ADMIN_ORDER_ID,
      preview: true,
      receiver: {
        address: '12 Admiralty Way',
        city: 'Lagos',
        state: 'Lagos',
        phone: '+2348000000000',
      },
    });
  });

  it('parses admin_order_id from the request body', async () => {
    const result = await resolveAdminOrderGiglQuoteInput(
      makeRequest({
        admin_order_id: ADMIN_ORDER_ID,
        preview: false,
        receiver: {
          address: '12 Admiralty Way',
          phone: '+2348000000000',
        },
      })
    );

    expect(result).toEqual({
      admin_order_id: ADMIN_ORDER_ID,
      preview: false,
      receiver: {
        address: '12 Admiralty Way',
        phone: '+2348000000000',
      },
    });
  });

  it('uses the admin order header with an order-scoped body schema', async () => {
    const result = await resolveAdminOrderGiglQuoteInput(
      makeRequest(
        {
          receiver: {
            address: '12 Admiralty Way',
            phone: '+2348000000000',
            latitude: 6.45,
            longitude: 3.39,
          },
        },
        { 'x-baci-admin-order-id': ADMIN_ORDER_ID }
      )
    );

    expect(result).toEqual({
      admin_order_id: ADMIN_ORDER_ID,
      preview: undefined,
      receiver: {
        address: '12 Admiralty Way',
        phone: '+2348000000000',
        latitude: 6.45,
        longitude: 3.39,
      },
    });
  });

  it('returns an invalid-input error for a non-uuid admin_order_id', async () => {
    const result = await resolveAdminOrderGiglQuoteInput(makeRequest({}), {
      admin_order_id: 'not-a-uuid',
      receiver: {
        address: '12 Admiralty Way',
        phone: '+2348000000000',
      },
    });

    expect(result).toMatchObject({
      error: {
        error: 'Invalid input',
      },
    });
  });

  it('returns an invalid-input error when the body fails schema validation', async () => {
    const result = await resolveAdminOrderGiglQuoteInput(
      makeRequest({ admin_order_id: 'not-a-uuid' })
    );

    expect(result).toMatchObject({
      error: {
        error: 'Invalid input',
      },
    });
  });

  it('returns an invalid-input error when latitude is provided without longitude', async () => {
    const result = await resolveAdminOrderGiglQuoteInput(
      makeRequest({
        admin_order_id: ADMIN_ORDER_ID,
        receiver: {
          address: '12 Admiralty Way',
          phone: '+2348000000000',
          latitude: 6.45,
        },
      })
    );

    expect(result).toMatchObject({
      error: {
        error: 'Invalid input',
      },
    });
  });
});
