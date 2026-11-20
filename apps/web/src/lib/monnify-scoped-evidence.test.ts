import { describe, expect, it } from 'vitest';
import { parseMonnifyAnswer } from './monnify-answer-parse';
import { readMonnifyAnswer } from './monnify-answer-reading';
import { hasBodyToken } from './monnify-bills-status';
import { hasMonnifyProviderReference } from './monnify-rejection-vend-reference';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { hasMonnifyExplicitVendFailure } from './monnify-unresolved-answer';

const REQ = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const proves = (rawMessage: string, envelope: unknown = {}) =>
  isMonnifyRequeryRejectionDefiniteFailure({ envelope, rawMessage });

describe('bugfix: error and ancillary objects are not vend evidence', () => {
  it.each([
    'error',
    'exception',
    'refund',
    'reversal',
    'settlement',
    'chargeback',
  ])('ignores %s.status FAILED', (parent) => {
    expect(
      hasMonnifyExplicitVendFailure({
        responseBody: { [parent]: { status: 'FAILED' } },
      })
    ).toBe(false);
  });

  it.each([
    'refund',
    'reversal',
    'settlement',
    'chargeback',
    'error',
  ])('ignores %s.reference', (parent) => {
    expect(
      hasMonnifyProviderReference(
        { responseBody: { [parent]: { reference: 'X-1' } } },
        REQ
      )
    ).toBe(false);
  });

  it.each([
    'request',
    'auth',
    'error',
    'credential',
    'login',
  ])('ignores %s.token as a voucher', (parent) => {
    expect(
      hasBodyToken({ responseBody: { [parent]: { token: 'access-token-1' } } })
    ).toBe(false);
  });

  it('still finds a real metaData.token', () => {
    expect(
      hasBodyToken({ responseBody: { metaData: { token: '1111-2222' } } })
    ).toBe(true);
  });
});

describe('bugfix: bare reversed/declined flags do not prove the vend failed', () => {
  it.each([
    'reversed',
    'declined',
    'cancelled',
    'rejected',
  ])('ignores %s: true', (flag) => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { [flag]: true } })
    ).toBe(false);
  });

  it('still accepts failed: true inside the body and a vend-scoped vendReversed', () => {
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { failed: true } })
    ).toBe(true);
    expect(
      hasMonnifyExplicitVendFailure({ responseBody: { vendReversed: true } })
    ).toBe(true);
  });
});

describe('bugfix: lookup and ancillary guards are scoped to their own clause', () => {
  it.each([
    'Vend failed. Status lookup failed',
    'Vend failed; refund failed',
    'Transaction failed. Callback notification failed',
  ])('still proves failure for "%s"', (message) => {
    expect(proves(message)).toBe(true);
  });

  it.each([
    'Status lookup failed',
    'Refund failed',
    'Transaction reversal failed',
  ])('keeps the single clause "%s" unresolved', (message) => {
    expect(proves(message)).toBe(false);
  });
});

describe('bugfix: catalog codes in raw JSON are not response codes', () => {
  it('does not read product.code 500 as an unexpected error', () => {
    const reading = readMonnifyAnswer(
      '400 Bad Request',
      JSON.stringify({
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance',
        responseBody: { product: { code: '500' } },
      })
    );

    expect(reading.reportsUnexpectedError).toBe(false);
    expect(reading.isKnownRefusal).toBe(true);
  });

  it('still reads a plain-text code 99 and a structured code 99', () => {
    expect(
      readMonnifyAnswer('400', 'Code 99: Insufficient wallet balance')
        .reportsUnexpectedError
    ).toBe(true);
    expect(parseMonnifyAnswer('{"responseCode":"99"}')).toBeTruthy();
    expect(
      readMonnifyAnswer('400', '{"responseCode":"99"}').reportsUnexpectedError
    ).toBe(true);
  });
});
