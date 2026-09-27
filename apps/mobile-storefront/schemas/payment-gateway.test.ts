import { describe, expect, it } from '@jest/globals';
import type { Href } from 'expo-router';
import type { ZodIssue } from 'zod';
import { PaymentGatewayParamsSchema } from '@/schemas/payment-gateway';

function acceptNavigationHref(_href: Href) {}

function extractIssuePaths(issues: ZodIssue[]) {
  return issues.map((issue) => issue.path.join('.'));
}

function extractIssueMessages(issues: ZodIssue[]) {
  return issues.map((issue) => issue.message);
}

describe('PaymentGatewayParamsSchema', () => {
  it('parses an order checkout payload with defaults', () => {
    const result = PaymentGatewayParamsSchema.parse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderNumber: 'ORD-123',
      reference: 'ref-123',
    });

    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/test');
    expect(result.gateway).toBe('paystack');
    expect(result.reference).toBe('ref-123');
    expect(result.amount).toBeUndefined();
    expect(result.paymentKind).toBe('order');
  });

  it('preserves an optional tracking token for guest order recovery', () => {
    const result = PaymentGatewayParamsSchema.parse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderId: 'order-id-123',
      reference: 'ref-123',
      trackingToken: ' track-token-123 ',
    });

    expect(result.trackingToken).toBe('track-token-123');
  });

  it('leaves tracking token undefined when it is omitted', () => {
    const result = PaymentGatewayParamsSchema.parse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderId: 'order-id-123',
      reference: 'ref-123',
    });

    expect(result.trackingToken).toBeUndefined();
  });

  it('trims whitespace-only tracking tokens to an empty string', () => {
    const result = PaymentGatewayParamsSchema.parse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderId: 'order-id-123',
      reference: 'ref-123',
      trackingToken: '   ',
    });

    expect(result.trackingToken).toBe('');
  });

  it('requires order ID or order number for order payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'order',
      reference: 'ref-123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractIssuePaths(result.error.issues)).toEqual(['orderId']);
      expect(extractIssueMessages(result.error.issues)).toEqual([
        'Order ID or order number is required for order payments',
      ]);
    }
  });

  it.each([
    ['orderId', { orderId: 'order-id-123' }],
    ['orderNumber', { orderNumber: 'ORD-123' }],
  ])('parses order payments with %s', (_field, identifier) => {
    expect(
      PaymentGatewayParamsSchema.safeParse({
        authorizationUrl: 'https://checkout.paystack.com/test',
        gateway: 'paystack',
        paymentKind: 'order',
        reference: 'ref-123',
        ...identifier,
      }).success
    ).toBe(true);
  });

  it.each([
    ['orderId', { orderId: '   ' }],
    ['orderNumber', { orderNumber: '\t' }],
  ])('rejects whitespace-only %s values', (field, identifier) => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'order',
      reference: 'ref-123',
      ...identifier,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractIssuePaths(result.error.issues)).toEqual([field]);
      expect(extractIssueMessages(result.error.issues)).toEqual([
        field === 'orderId'
          ? 'Order ID cannot be empty'
          : 'Order number cannot be empty',
      ]);
    }
  });

  it('rejects whitespace-only URL, reference, and VTU customer identifier', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: '   ',
      customerIdentifier: ' ',
      gateway: 'paystack',
      paymentKind: 'vtu',
      reference: '\t',
      utilityType: 'power',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractIssuePaths(result.error.issues)).toEqual(
        expect.arrayContaining([
          'authorizationUrl',
          'customerIdentifier',
          'reference',
        ])
      );
    }
  });

  it('requires VTU customer and service context for VTU payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '1000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'vtu',
      reference: 'ref-123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = extractIssuePaths(result.error.issues);
      expect(issuePaths).toEqual(
        expect.arrayContaining(['utilityType', 'customerIdentifier'])
      );
    }
  });

  it('does not validate order identifiers for VTU payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      customerIdentifier: '08012345678',
      gateway: 'paystack',
      orderId: ' ',
      paymentKind: 'vtu',
      reference: 'ref-123',
      utilityType: 'airtime',
    });

    expect(result.success).toBe(true);
  });

  it('does not require order identifiers for wallet top-up payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '2500',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(2500);
      expect(result.data.merchantId).toBe('merchant-1');
      expect(result.data.paymentKind).toBe('wallet');
      expect(result.data.reference).toBe('WAL-123');
    }
  });

  it('coerces an optional canonical order total for order payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '5000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderId: 'order-1',
      orderTotal: '21500',
      paymentKind: 'order',
      reference: 'ref-123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(5000);
      expect(result.data.orderTotal).toBe(21500);
    }
  });

  it('preserves valid returnTo paths for wallet top-up payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '2500',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
      returnTo: '/imei-check',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.returnTo).toBe('/imei-check');
      if (result.data.returnTo) {
        acceptNavigationHref(result.data.returnTo);
      }
    }
  });

  it('preserves valid returnTo paths for savings card authorization', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'savings_auth',
      reference: 'SAV-AUTH-123',
      returnTo: '/wallet/savings/start',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentKind).toBe('savings_auth');
      expect(result.data.returnTo).toBe('/wallet/savings/start');
    }
  });

  it('does not require amount, merchant, or order identifiers for savings auth', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'savings_auth',
      reference: 'SAV-AUTH-123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBeUndefined();
      expect(result.data.merchantId).toBeUndefined();
      expect(result.data.orderId).toBeUndefined();
    }
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil',
    '/safe/../evil',
  ])('normalizes invalid savings auth returnTo %s', (returnTo) => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'savings_auth',
      reference: 'SAV-AUTH-123',
      returnTo,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.returnTo).toBeUndefined();
    }
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil',
    '/safe/../evil',
    '/safe/./evil',
    '/safe%2fevil',
    '/safe%5cevil',
    '',
    '   ',
  ])('normalizes invalid wallet returnTo %s', (returnTo) => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '2500',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantId: 'merchant-1',
      paymentKind: 'wallet',
      reference: 'WAL-123',
      returnTo,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.returnTo).toBeUndefined();
    }
  });

  it('drops returnTo for non-wallet payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderNumber: 'ORD-123',
      paymentKind: 'order',
      reference: 'ref-123',
      returnTo: '/imei-check',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.returnTo).toBeUndefined();
    }
  });

  it('requires a positive amount for wallet top-up payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractIssuePaths(result.error.issues)).toContain('amount');
      expect(extractIssueMessages(result.error.issues)).toContain(
        'Amount is required for wallet top-up payments'
      );
    }
  });

  it('requires merchant context for wallet top-up payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '2500',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractIssuePaths(result.error.issues)).toContain('merchantSlug');
      expect(extractIssueMessages(result.error.issues)).toContain(
        'Merchant slug or id is required'
      );
    }
  });

  it('accepts merchant slug for wallet top-up payments', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '2500',
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      merchantSlug: 'ogabassey',
      paymentKind: 'wallet',
      reference: 'WAL-123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merchantSlug).toBe('ogabassey');
    }
  });

  it('parses a valid VTU checkout payload with a positive numeric amount', () => {
    const result = PaymentGatewayParamsSchema.parse({
      amount: '1500.50',
      authorizationUrl: 'https://checkout.paystack.com/test',
      customerIdentifier: '43901766923',
      gateway: 'paystack',
      paymentKind: 'vtu',
      reference: 'ref-123',
      utilityType: 'power',
    });

    expect(result.amount).toBe(1500.5);
    expect(result.customerIdentifier).toBe('43901766923');
    expect(result.paymentKind).toBe('vtu');
    expect(result.utilityType).toBe('power');
  });

  it.each([
    ['amount "0"', '0', 'Amount must be greater than 0'],
    ['amount "-1"', '-1', 'Amount must be greater than 0'],
    ['non-numeric amount', 'not-a-number', 'Amount must be a valid number'],
  ])('%s is rejected', (_label, amount, message) => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount,
      authorizationUrl: 'https://checkout.paystack.com/test',
      gateway: 'paystack',
      orderNumber: 'ORD-123',
      reference: 'ref-123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractIssuePaths(result.error.issues)).toContain('amount');
      expect(extractIssueMessages(result.error.issues)).toContain(message);
    }
  });

  it('rejects invalid gateway params', () => {
    const result = PaymentGatewayParamsSchema.safeParse({
      amount: '1000',
      authorizationUrl: 'not-a-url',
      gateway: 'invalid',
      reference: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = extractIssuePaths(result.error.issues);
      expect(issuePaths).toEqual(
        expect.arrayContaining(['authorizationUrl', 'gateway', 'reference'])
      );
    }
  });
});
