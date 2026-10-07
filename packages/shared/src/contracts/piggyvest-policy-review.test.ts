import { describe, expect, it } from 'vitest';
import { piggyvestPolicyReviewSchemas as schemas } from './piggyvest-policy-review';

const acceptance = {
  goalId: '10000000-0000-4000-8000-000000000001',
  revisionId: '20000000-0000-4000-8000-000000000001',
  termsHash: 'a'.repeat(64),
  termsVersion: 'synthetic-v1',
  accepted: true,
};
const draft = {
  status: 'draft',
  goalId: acceptance.goalId,
  revisionId: acceptance.revisionId,
  device: {
    productName: 'Synthetic phone',
    variant: '128 GB / Green',
    condition: 'Used',
  },
  terms: {
    hash: acceptance.termsHash,
    version: acceptance.termsVersion,
    text: '  Synthetic terms.\nSecond paragraph.  ',
  },
  consent: 'required',
};

describe('public policy review schemas', () => {
  it.each([
    1, 6,
  ])('preserves explicit duration %s on draft and acceptance', (durationMonths) => {
    expect(schemas.view.parse({ ...draft, durationMonths })).toMatchObject({
      durationMonths,
    });
    expect(
      schemas.acceptance.parse({ ...acceptance, durationMonths })
    ).toMatchObject({ durationMonths });
  });
  it.each([
    0,
    7,
    1.5,
    '3',
    null,
  ])('rejects invalid explicit duration %j', (durationMonths) => {
    expect(schemas.view.safeParse({ ...draft, durationMonths }).success).toBe(
      false
    );
    expect(
      schemas.acceptance.safeParse({ ...acceptance, durationMonths }).success
    ).toBe(false);
  });
  it('does not default a legacy duration', () => {
    expect(schemas.view.parse(draft)).not.toHaveProperty('durationMonths');
    expect(schemas.acceptance.parse(acceptance)).not.toHaveProperty(
      'durationMonths'
    );
  });
  it('preserves multibyte device labels within the existing character limit', () => {
    expect(
      schemas.view.safeParse({
        ...draft,
        device: { ...draft.device, productName: 'é'.repeat(200) },
      }).success
    ).toBe(true);
  });
  it('accepts a genuine nonvariant product without inventing a label', () => {
    expect(
      schemas.view.parse({
        ...draft,
        device: { ...draft.device, variant: null },
      })
    ).toMatchObject({ device: { variant: null } });
  });

  it.each([
    'a'.repeat(32768),
    'é'.repeat(16384),
  ])('accepts terms at the 32768-byte boundary', (content) => {
    expect(
      schemas.view.safeParse({
        ...draft,
        terms: { ...draft.terms, text: content },
      }).success
    ).toBe(true);
  });

  it.each([
    'a'.repeat(32769),
    'é'.repeat(16385),
    '\uD800',
  ])('rejects oversized or malformed Unicode terms', (content) => {
    expect(
      schemas.view.safeParse({
        ...draft,
        terms: { ...draft.terms, text: content },
      }).success
    ).toBe(false);
  });
  it('preserves exact supplied draft terms and accepted consent', () => {
    expect(schemas.view.parse(draft)).toEqual(draft);
    expect(schemas.view.parse({ ...draft, consent: 'accepted' })).toMatchObject(
      { consent: 'accepted' }
    );
    expect(schemas.view.parse({ status: 'unavailable' })).toEqual({
      status: 'unavailable',
    });
    expect(schemas.acceptance.parse(acceptance)).toEqual(acceptance);
  });

  it.each([
    { ...draft, status: 'active' },
    { ...draft, consent: 'assumed' },
    { ...draft, goalId: 'invalid' },
    { ...draft, revisionId: '' },
    { ...draft, terms: { ...draft.terms, text: ' ' } },
    { ...draft, terms: { ...draft.terms, hash: 'unknown' } },
    { ...draft, terms: { ...draft.terms, version: '' } },
    { ...draft, device: { ...draft.device, variant: '' } },
    { ...draft, apiSecret: 'synthetic-private' },
    { ...draft, device: { ...draft.device, providerWalletId: 'private' } },
    { status: 'unavailable', terms: draft.terms },
  ])('rejects invalid or expanded projections', (value) => {
    expect(schemas.view.safeParse(value).success).toBe(false);
  });

  it.each([
    { ...acceptance, accepted: false },
    { ...acceptance, actorId: 'private' },
    { ...acceptance, termsHash: '' },
    { ...acceptance, termsVersion: 'invalid version' },
  ])('rejects unconsented or expanded acceptance payloads', (value) => {
    expect(schemas.acceptance.safeParse(value).success).toBe(false);
  });
});
