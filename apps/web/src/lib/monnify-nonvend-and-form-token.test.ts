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

describe('bugfix: a token only counts where a vend puts it', () => {
  it('counts responseBody.token and responseBody.metaData.token', () => {
    expect(hasBodyToken({ responseBody: { token: '1111-2222' } })).toBe(true);
    expect(
      hasBodyToken({ responseBody: { metaData: { token: '1111-2222' } } })
    ).toBe(true);
  });

  it('ignores a token nested under any other object, however deep', () => {
    expect(
      hasBodyToken({
        responseBody: { data: { result: { token: 'sess-abc-123' } } },
      })
    ).toBe(false);
    expect(
      hasBodyToken({ responseBody: { session: { token: 'sess-abc-123' } } })
    ).toBe(false);
  });

  it('has no depth limit to overflow', () => {
    let deep: Record<string, unknown> = { token: 'sess-abc-123' };
    for (let i = 0; i < 12; i++) {
      deep = { nested: deep };
    }

    expect(hasBodyToken({ responseBody: deep })).toBe(false);
  });
});
