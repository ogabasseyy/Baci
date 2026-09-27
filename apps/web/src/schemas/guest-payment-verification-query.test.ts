import { describe, expect, it } from 'vitest';
import { guestPaymentVerificationQuerySchema } from './guest-payment-verification-query';

describe('guestPaymentVerificationQuerySchema', () => {
  it('accepts a reference with its tracking token', () => {
    expect(
      guestPaymentVerificationQuerySchema.parse({
        reference: '  PAY-REF-1  ',
        trackingToken: '  track-1  ',
      })
    ).toEqual({ reference: 'PAY-REF-1', trackingToken: 'track-1' });
  });

  it('rejects a missing or blank reference', () => {
    expect(
      guestPaymentVerificationQuerySchema.safeParse({
        trackingToken: 'track-1',
      }).success
    ).toBe(false);
    expect(
      guestPaymentVerificationQuerySchema.safeParse({
        reference: '   ',
        trackingToken: 'track-1',
      }).success
    ).toBe(false);
  });

  it('rejects a missing or blank tracking token', () => {
    expect(
      guestPaymentVerificationQuerySchema.safeParse({ reference: 'PAY-REF-1' })
        .success
    ).toBe(false);
    expect(
      guestPaymentVerificationQuerySchema.safeParse({
        reference: 'PAY-REF-1',
        trackingToken: '',
      }).success
    ).toBe(false);
  });

  it('rejects overlong values and unknown keys', () => {
    expect(
      guestPaymentVerificationQuerySchema.safeParse({
        reference: 'r'.repeat(101),
        trackingToken: 'track-1',
      }).success
    ).toBe(false);
    expect(
      guestPaymentVerificationQuerySchema.safeParse({
        reference: 'PAY-REF-1',
        trackingToken: 't'.repeat(257),
      }).success
    ).toBe(false);
    expect(
      guestPaymentVerificationQuerySchema.safeParse({
        reference: 'PAY-REF-1',
        trackingToken: 'track-1',
        admin: true,
      }).success
    ).toBe(false);
  });
});
