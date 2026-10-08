import { describe, expect, it } from 'vitest';
import { piggyvestCustomerPolicyRequestSchemas as schemas } from './piggyvest-customer-policy-request';

const goalId = '30000000-0000-4000-8000-000000000001';
const acceptance = {
  goalId,
  revisionId: '70000000-0000-4000-8000-000000000001',
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  accepted: true,
};

describe('customer policy request schemas', () => {
  it('accepts optional exact duration with no default and rejects invalid values', () => {
    expect(schemas.accept.parse(acceptance)).not.toHaveProperty(
      'durationMonths'
    );
    expect(
      schemas.accept.parse({ ...acceptance, durationMonths: 1 })
    ).toMatchObject({ durationMonths: 1 });
    for (const durationMonths of [null, 0, 1.5, 7, '1']) {
      expect(
        schemas.accept.safeParse({ ...acceptance, durationMonths }).success
      ).toBe(false);
    }
  });
  it('accepts only goal selection and explicit revision consent', () => {
    expect(schemas.read.parse({ goalId })).toEqual({ goalId });
    expect(schemas.accept.parse(acceptance)).toEqual(acceptance);
  });
  it.each([
    { accepted: false },
    { accepted: undefined },
    { actorId: goalId },
    { customerId: goalId },
    { termsHash: 'invalid' },
    { termsVersion: '' },
    { revisionId: null },
    { termsText: 'forged' },
  ])('rejects incomplete or injected acceptance', (override) => {
    expect(
      schemas.accept.safeParse({ ...acceptance, ...override }).success
    ).toBe(false);
  });
  it('rejects extra GET scope', () => {
    expect(schemas.read.safeParse({ goalId, merchantId: goalId }).success).toBe(
      false
    );
  });
  it.each([
    '',
    ' ',
    '\ud800',
    'x'.repeat(32_769),
    '界'.repeat(11_000),
  ])('rejects absent, invalid or excessive document text', (text) => {
    expect(
      schemas.terms.safeParse({
        version: 'synthetic-v1',
        hash: 'a'.repeat(64),
        text,
      }).success
    ).toBe(false);
  });
  it('preserves exact document bytes without trimming text', () => {
    const terms = {
      version: 'synthetic-v1',
      hash: 'a'.repeat(64),
      text: ' Synthetic test document.\n',
    };
    expect(schemas.terms.parse(terms)).toEqual(terms);
  });
});
