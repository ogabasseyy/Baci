import { describe, expect, it } from 'vitest';
import {
  StorefrontDiscountValidateRequestSchema,
  StorefrontDiscountValidateResponseSchema,
} from './storefront-discount';

describe('StorefrontDiscountValidateRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: 'SAVE10',
        cart_total: 5000,
      }).success
    ).toBe(true);
  });

  it('accepts optional targeting arrays for UX preflight', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: 'SAVE10',
        cart_total: 5000,
        product_ids: ['prod-1'],
        category_ids: ['cat-1'],
      }).success
    ).toBe(true);
  });

  it('rejects a blank code', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: '   ',
        cart_total: 5000,
      }).success
    ).toBe(false);
  });

  it('rejects a negative cart_total', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: 'SAVE10',
        cart_total: -1,
      }).success
    ).toBe(false);
  });

  it('accepts a code at the 50-character maximum', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: 'X'.repeat(50),
        cart_total: 5000,
      }).success
    ).toBe(true);
  });

  it('rejects a code exceeding 50 characters', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: 'X'.repeat(51),
        cart_total: 5000,
      }).success
    ).toBe(false);
  });

  it('accepts a cart_total of 0 (zero boundary)', () => {
    expect(
      StorefrontDiscountValidateRequestSchema.safeParse({
        merchant_id: '11111111-1111-4111-8111-111111111111',
        code: 'SAVE10',
        cart_total: 0,
      }).success
    ).toBe(true);
  });
});

describe('StorefrontDiscountValidateResponseSchema', () => {
  it('parses a valid applied-discount response', () => {
    expect(
      StorefrontDiscountValidateResponseSchema.safeParse({
        valid: true,
        discount_code_id: '22222222-2222-4222-8222-222222222222',
        code: 'SAVE10',
        discount_type: 'percentage',
        discount_value: 10,
        discount_amount: 500,
        description: null,
      }).success
    ).toBe(true);
  });

  it('parses an invalid-code response', () => {
    expect(
      StorefrontDiscountValidateResponseSchema.safeParse({
        valid: false,
        error: 'x',
      }).success
    ).toBe(true);
  });

  it('rejects a malformed valid response with no amount details', () => {
    expect(
      StorefrontDiscountValidateResponseSchema.safeParse({ valid: true })
        .success
    ).toBe(false);
  });

  it('parses a loyalty success with a null discount_code_id', () => {
    expect(
      StorefrontDiscountValidateResponseSchema.safeParse({
        valid: true,
        discount_code_id: null,
        code: 'RDM-ABCDEF12',
        discount_type: 'fixed',
        discount_value: 1000,
        discount_amount: 1000,
      }).success
    ).toBe(true);
  });
});
