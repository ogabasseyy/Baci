import { describe, expect, it } from 'vitest';

import { redactPaymentLogValue } from './redact-payment-log-value';

describe('redactPaymentLogValue', () => {
  it('redacts order tracking proofs in payment initialization logs', () => {
    expect(
      redactPaymentLogValue({
        tracking_token: 'secret-proof',
        nested: { trackingToken: 'another-secret-proof' },
        order_id: 'order-123',
      })
    ).toEqual({
      tracking_token: '[REDACTED]',
      nested: { trackingToken: '[REDACTED]' },
      order_id: 'order-123',
    });
  });

  it('redacts payment customer and billing PII without mutating the source value', () => {
    const source = {
      merchant_id: 'merchant-123',
      order_id: 'order-123',
      amount: 5000,
      customer_email: 'customer@example.com',
      customer_name: 'John Doe',
      customer_phone: '08012345678',
      billing_address: {
        line1: '123 Main St',
        city: 'Lagos',
        zip_code: '100001',
      },
    };

    const redacted = redactPaymentLogValue(source);

    expect(redacted).toEqual({
      merchant_id: 'merchant-123',
      order_id: 'order-123',
      amount: 5000,
      customer_email: '[REDACTED]',
      customer_name: '[REDACTED]',
      customer_phone: '[REDACTED]',
      billing_address: '[REDACTED]',
    });
    expect(source.customer_email).toBe('customer@example.com');
    expect(source.billing_address.line1).toBe('123 Main St');
  });

  it('redacts Paystack phone debug aliases', () => {
    expect(
      redactPaymentLogValue({
        original_phone: '08012345678',
        formatted_phone: '+2348012345678',
        type: 'string',
      })
    ).toEqual({
      original_phone: '[REDACTED]',
      formatted_phone: '[REDACTED]',
      type: 'string',
    });
  });

  it('redacts camelCase payment PII keys', () => {
    expect(
      redactPaymentLogValue({
        customerEmail: 'customer@example.com',
        customerName: 'John Doe',
        customerPhone: '08012345678',
        mobileNumber: '08012345678',
        safeMetadata: 'keep-me',
      })
    ).toEqual({
      customerEmail: '[REDACTED]',
      customerName: '[REDACTED]',
      customerPhone: '[REDACTED]',
      mobileNumber: '[REDACTED]',
      safeMetadata: 'keep-me',
    });
  });

  it('redacts nested credential and financial identity aliases without hiding operational fields', () => {
    expect(
      redactPaymentLogValue({
        order_id: 'order-1',
        amount: 5000,
        status: 'pending',
        nested: [
          {
            apiKey: 'secret',
            accessToken: 'token',
            authorization: 'Bearer secret',
            bvn: '123',
            NINNumber: '456',
            bankAccountNumber: '789',
            cardNumber: '12',
            cvv: '123',
            pin: '1234',
            otp: '123456',
            dateOfBirth: '2000-01-01',
            client_secret: 'secret',
            password: 'password',
            cookie: 'session',
          },
        ],
      })
    ).toEqual({
      order_id: 'order-1',
      amount: 5000,
      status: 'pending',
      nested: [
        {
          apiKey: '[REDACTED]',
          accessToken: '[REDACTED]',
          authorization: '[REDACTED]',
          bvn: '[REDACTED]',
          NINNumber: '[REDACTED]',
          bankAccountNumber: '[REDACTED]',
          cardNumber: '[REDACTED]',
          cvv: '[REDACTED]',
          pin: '[REDACTED]',
          otp: '[REDACTED]',
          dateOfBirth: '[REDACTED]',
          client_secret: '[REDACTED]',
          password: '[REDACTED]',
          cookie: '[REDACTED]',
        },
      ],
    });
  });

  it('redacts common suffixed identity aliases but preserves ordinary status fields', () => {
    expect(
      redactPaymentLogValue({
        bvnValue: '123',
        ninNumber: '123',
        otp_code: '123',
        bankAccountNo: '123',
        bank_verification_number: '123',
        authorization_header: 'bearer',
        processingStatus: 'pending',
        order_reference: 'ref',
      })
    ).toEqual({
      bvnValue: '[REDACTED]',
      ninNumber: '[REDACTED]',
      otp_code: '[REDACTED]',
      bankAccountNo: '[REDACTED]',
      bank_verification_number: '[REDACTED]',
      authorization_header: '[REDACTED]',
      processingStatus: 'pending',
      order_reference: 'ref',
    });
  });

  it('handles circular arrays without infinite recursion', () => {
    const circular: unknown[] = [];
    circular.push(circular);

    expect(redactPaymentLogValue(circular)).toEqual([{ circular: true }]);
  });

  it('does not treat shared non-circular objects as circular', () => {
    const sharedAddress = { line1: '123 Main St', city: 'Lagos' };

    expect(
      redactPaymentLogValue({
        shipping: sharedAddress,
        billing: sharedAddress,
      })
    ).toEqual({
      shipping: { line1: '[REDACTED]', city: '[REDACTED]' },
      billing: { line1: '[REDACTED]', city: '[REDACTED]' },
    });
  });
});
