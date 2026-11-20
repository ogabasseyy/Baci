import { describe, expect, it } from 'vitest';
import { parseMonnifyAnswer } from './monnify-answer-parse';
import { hasBodyToken } from './monnify-bills-status';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';

const held = (responseBody: Record<string, unknown>) =>
  isMonnifyUnresolvedAnswer({
    answer: { responseCode: '01', responseBody },
    wording: 'Invalid customer',
  });

describe('bugfix: non-vend statuses never enter the outcome state', () => {
  it.each([
    ['customerStatus', 'PENDING'],
    ['productStatus', 'SUCCESS'],
    ['billerStatus', 'COMPLETED'],
    ['refundStatus', 'PROCESSING'],
  ])('does not hold %s: %s', (key, value) => {
    expect(held({ [key]: value })).toBe(false);
  });

  it('still holds vendStatus PENDING', () => {
    expect(held({ vendStatus: 'PENDING' })).toBe(true);
  });
});

describe('bugfix: hedge words are scoped to the failure clause', () => {
  it.each([
    'Transaction failed. You may retry',
    'Vend failed; the customer may contact support',
  ])('still proves failure for "%s"', (message) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: message,
      })
    ).toBe(true);
  });

  it.each([
    'Transaction may have failed',
    'Purchase might fail',
    'The vend appears to have failed',
  ])('keeps the hedge "%s" unresolved', (message) => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: {},
        rawMessage: message,
      })
    ).toBe(false);
  });
});

describe('bugfix: tokens are found in parsed form-encoded bodies', () => {
  it('finds responseBody[token] in a form-encoded answer', () => {
    const parsed = parseMonnifyAnswer(
      'responseBody[token]=1111-2222&responseCode=01&responseMessage=Insufficient+wallet+balance'
    );

    expect(hasBodyToken(parsed)).toBe(true);
  });

  it('ignores a placeholder or a token outside responseBody', () => {
    expect(
      hasBodyToken(
        parseMonnifyAnswer('responseBody[token]=N/A&responseCode=01')
      )
    ).toBe(false);
    expect(hasBodyToken({ token: '1111-2222' })).toBe(false);
  });
});

describe('bugfix: a body too deeply nested to scan for a token is held', () => {
  it('treats overflow as a possible token (fail closed)', () => {
    let deep: Record<string, unknown> = { token: 'N/A' };
    for (let i = 0; i < 12; i++) {
      deep = { nested: deep };
    }

    expect(hasBodyToken({ responseBody: deep })).toBe(true);
  });

  it('still returns false for a shallow body without a token', () => {
    expect(hasBodyToken({ responseBody: { vendStatus: 'FAILED' } })).toBe(
      false
    );
  });
});
