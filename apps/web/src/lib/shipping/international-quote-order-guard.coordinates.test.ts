import { describe, expect, it } from 'vitest';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import type { QuoteRequest } from './types';

const baseQuoteRequest: QuoteRequest = {
  sessionId: 'session-1',
  shipmentType: 'domestic',
  receiver: {
    name: 'Jane Receiver',
    phone: '',
    email: 'jane@example.com',
    address: '123 Queen Street West',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [],
};

const baseOrder = {
  shipping_address: {
    address: '123 Queen Street West',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
};

function withCoordinates(
  request: QuoteRequest,
  latitude?: number,
  longitude?: number
): QuoteRequest {
  return {
    ...request,
    receiver: {
      ...request.receiver,
      ...(latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : {}),
    },
  };
}

function orderWithCoordinates(latitude?: number, longitude?: number) {
  return {
    shipping_address: {
      ...baseOrder.shipping_address,
      ...(latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : {}),
    },
  };
}

describe('assertQuoteReceiverMatchesOrder coordinate attestation', () => {
  it('allows a saved quote when receiver coordinates are unchanged', () => {
    const quote = withCoordinates(baseQuoteRequest, 6.5244, 3.3792);

    expect(() =>
      assertQuoteReceiverMatchesOrder(
        quote,
        orderWithCoordinates(6.5244, 3.3792)
      )
    ).not.toThrow();
  });

  it('rejects a saved quote when receiver coordinates materially changed', () => {
    const quote = withCoordinates(baseQuoteRequest, 6.5244, 3.3792);

    expect(() =>
      assertQuoteReceiverMatchesOrder(
        quote,
        orderWithCoordinates(6.5245, 3.3792)
      )
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });

  it.each([
    {
      label: 'quote has coordinates but order does not',
      quote: withCoordinates(baseQuoteRequest, 6.5244, 3.3792),
      order: orderWithCoordinates(),
    },
    {
      label: 'order has coordinates but quote does not',
      quote: withCoordinates(baseQuoteRequest),
      order: orderWithCoordinates(6.5244, 3.3792),
    },
  ])('rejects when $label', ({ quote, order }) => {
    expect(() => assertQuoteReceiverMatchesOrder(quote, order)).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });

  it('allows tiny coordinate serialization drift', () => {
    const quote = withCoordinates(baseQuoteRequest, 6.5244, 3.3792);

    expect(() =>
      assertQuoteReceiverMatchesOrder(
        quote,
        orderWithCoordinates(6.5244004, 3.3791996)
      )
    ).not.toThrow();
  });

  it('accepts trimmed numeric-string order coordinates from persisted JSON', () => {
    const quote = withCoordinates(baseQuoteRequest, 6.5244, 3.3792);
    const order = {
      shipping_address: {
        ...baseOrder.shipping_address,
        latitude: ' 6.5244000 ',
        longitude: '3.3792',
      },
    };

    expect(() => assertQuoteReceiverMatchesOrder(quote, order)).not.toThrow();
  });

  it.each([
    {
      label: 'latitude',
      latitude: 91,
      longitude: 3.3792,
    },
    {
      label: 'longitude',
      latitude: 6.5244,
      longitude: 181,
    },
  ])('rejects matching out-of-range $label coordinates', ({
    latitude,
    longitude,
  }) => {
    const quote = withCoordinates(baseQuoteRequest, latitude, longitude);

    expect(() =>
      assertQuoteReceiverMatchesOrder(
        quote,
        orderWithCoordinates(latitude, longitude)
      )
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });

  it('rejects a malformed coordinate on one side instead of falling back to text', () => {
    const quote = {
      ...baseQuoteRequest,
      receiver: {
        ...baseQuoteRequest.receiver,
        latitude: 'not-a-coordinate' as unknown as number,
        longitude: 3.3792,
      },
    };

    expect(() =>
      assertQuoteReceiverMatchesOrder(quote, orderWithCoordinates())
    ).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });

  it('rejects matching malformed coordinates on both sides', () => {
    const malformedCoordinates = {
      latitude: 'not-a-coordinate' as unknown as number,
      longitude: 'also-not-a-coordinate' as unknown as number,
    };
    const quote = {
      ...baseQuoteRequest,
      receiver: { ...baseQuoteRequest.receiver, ...malformedCoordinates },
    };
    const order = {
      shipping_address: {
        ...baseOrder.shipping_address,
        ...malformedCoordinates,
      },
    };

    expect(() => assertQuoteReceiverMatchesOrder(quote, order)).toThrowError(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );
  });
});
