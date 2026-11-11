import { describe, expect, it } from 'vitest';
import {
  INTERNAL_CATEGORIES,
  PVB_CREDIT_ID,
  REVIEW_ONLY,
} from './credit-gap-kinds';

describe('credit-gap kinds', () => {
  it('accepts only the documented PVB01 credit-id prefix', () => {
    expect(PVB_CREDIT_ID.test('PVB01ABC')).toBe(true);
    expect(PVB_CREDIT_ID.test('PVB01')).toBe(false);
    expect(PVB_CREDIT_ID.test('PVB01!!!')).toBe(false);
    expect(PVB_CREDIT_ID.test('PVB99ABC')).toBe(false);
    expect(PVB_CREDIT_ID.test('01M2TTNT0N08C81J5BEADH3BY8')).toBe(false);
  });

  it('keeps proven gaps and the namespace warning paging', () => {
    expect(REVIEW_ONLY.has('unrecorded_credit')).toBe(false);
    expect(REVIEW_ONLY.has('not_on_provider')).toBe(false);
    expect(REVIEW_ONLY.has('list_namespace_unproven')).toBe(false);
    expect(REVIEW_ONLY.has('unverified_reference')).toBe(true);
  });

  it('treats only the observed p2p category as internal', () => {
    expect([...INTERNAL_CATEGORIES]).toEqual(['p2p']);
  });
});
