import { describe, expect, it } from '@jest/globals';
import {
  sanitizeAnalyticsCaptureEvent,
  sanitizeAnalyticsProperties,
} from './analytics-privacy';

describe('analytics privacy helpers', () => {
  it('redacts sensitive values, URL queries, and unsupported JSON values', () => {
    expect(
      sanitizeAnalyticsProperties({
        email: 'buyer@example.com',
        note: 'Contact buyer@example.com',
        currentUrl:
          'https://buyer:secret@ogabassey.com/users/buyer@example.com?token=secret',
        callbackUrl: 'buyer:secret@ogabassey.com/users/buyer@example.com?x=1',
        apiKey: 'secret-api-key',
        apiKeys: ['secret-api-key'],
        accessKey: 'secret-access-key',
        privateKey: 'secret-private-key',
        tokens: ['secret-token'],
        loyaltyPoints: Number.POSITIVE_INFINITY,
        nested: {
          phone: '+2348000000000',
          keep: true,
        },
        message:
          'Call +234 801 234 5678, OTP 123456, card 4084 0840 8408 4081, BVN 12345678901.',
      })
    ).toEqual({
      email: '[Filtered]',
      note: 'Contact [Filtered]',
      currentUrl: 'https://ogabassey.com/users/[Filtered]',
      callbackUrl: 'ogabassey.com/users/[Filtered]',
      apiKey: '[Filtered]',
      apiKeys: '[Filtered]',
      accessKey: '[Filtered]',
      privateKey: '[Filtered]',
      tokens: '[Filtered]',
      nested: {
        phone: '[Filtered]',
        keep: true,
      },
      message: 'Call [Filtered], [Filtered], card [Filtered], BVN [Filtered].',
    });
  });

  it('sanitizes before_send capture events without dropping required event fields', () => {
    expect(
      sanitizeAnalyticsCaptureEvent({
        event: 'Checkout Failed',
        properties: {
          notificationId: '4111111111111111',
          notification_id: '123e4567-e89b-42d3-a456-426614174000',
          requestUrl:
            'https://ogabassey.com/customers/buyer@example.com?token=secret',
        },
        $set: {
          address: '12 Checkout Street',
        },
        $set_once: {
          first_seen_url: 'https://ogabassey.com/?email=buyer@example.com',
        },
      })
    ).toEqual({
      event: 'Checkout Failed',
      properties: {
        notificationId: '[Filtered]',
        notification_id: '123e4567-e89b-42d3-a456-426614174000',
        requestUrl: 'https://ogabassey.com/customers/[Filtered]',
      },
      $set: {
        address: '[Filtered]',
      },
      $set_once: {
        first_seen_url: 'https://ogabassey.com/',
      },
    });
  });

  it('preserves known order identifiers without disabling phone redaction elsewhere', () => {
    expect(
      sanitizeAnalyticsProperties({
        order: 'ORD-260627-9-5',
        orderNumber: 'ORD-260627-9-5',
        order_number: 'BAC-001',
        order_id: '11111111-1111-4111-8111-111111111111',
        fb_order_id: 'order-456',
        payment_reference: 'PAY-260627-001',
        product_sku: '9876543210987',
        sku: '1234567890123',
        note: 'Order ORD-260627-9-5, call +234 801 234 5678',
        phone: '+234 801 234 5678',
      })
    ).toEqual({
      order: 'ORD-260627-9-5',
      orderNumber: 'ORD-260627-9-5',
      order_number: 'BAC-001',
      order_id: '11111111-1111-4111-8111-111111111111',
      fb_order_id: 'order-456',
      payment_reference: 'PAY-260627-001',
      product_sku: '9876543210987',
      sku: '1234567890123',
      note: 'Order ORD-[Filtered], call [Filtered]',
      phone: '[Filtered]',
    });
  });

  it('does not preserve arbitrary long numeric sku-like values', () => {
    expect(
      sanitizeAnalyticsProperties({
        sku: '12345678901234567890',
      })
    ).toEqual({
      sku: '[Filtered]',
    });
  });

  it('drops cyclic object and array branches without hanging', () => {
    const cyclicObject: Record<string, unknown> = {
      note: 'Contact buyer@example.com',
    };
    cyclicObject.self = cyclicObject;

    const cyclicArray: unknown[] = ['safe'];
    cyclicArray.push(cyclicArray);

    expect(
      sanitizeAnalyticsProperties({
        cyclicObject,
        cyclicArray,
      })
    ).toEqual({
      cyclicObject: {
        note: 'Contact [Filtered]',
      },
      cyclicArray: ['safe'],
    });

    expect(
      sanitizeAnalyticsCaptureEvent({
        event: 'Cyclic Event',
        properties: {
          cyclicObject,
        },
      })
    ).toEqual({
      event: 'Cyclic Event',
      properties: {
        cyclicObject: {
          note: 'Contact [Filtered]',
        },
      },
      $set: undefined,
      $set_once: undefined,
    });
  });

  it('preserves supported primitives and drops non-finite numbers', () => {
    expect(
      sanitizeAnalyticsProperties({
        active: true,
        missing: null,
        count: 2,
        broken: Number.NaN,
      })
    ).toEqual({
      active: true,
      missing: null,
      count: 2,
    });
  });

  it('preserves null capture events and undefined property maps', () => {
    expect(sanitizeAnalyticsCaptureEvent(null)).toBeNull();
    expect(sanitizeAnalyticsProperties(undefined)).toBeUndefined();
  });
});
