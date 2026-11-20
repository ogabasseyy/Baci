import { describe, expect, it } from 'vitest';
import {
  classifyMonnifyBillStatus,
  readMonnifyBillToken,
} from './monnify-bills-status';

describe('classifyMonnifyBillStatus', () => {
  it('keeps a paid bill processing while delivery is in progress', () => {
    expect(
      classifyMonnifyBillStatus({ status: 'PAID', vendStatus: 'IN_PROGRESS' })
    ).toEqual({ isFailed: false, isProcessing: true, isSuccess: false });
  });

  it('uses the payment status when Monnify omits delivery status', () => {
    expect(classifyMonnifyBillStatus({ status: 'SUCCESSFUL' })).toEqual({
      isFailed: false,
      isProcessing: false,
      isSuccess: true,
    });
  });
});

describe('readMonnifyBillToken', () => {
  it('trims and prefers the first non-blank token', () => {
    expect(
      readMonnifyBillToken({ metaData: { token: ' A-1 ' }, token: 'B-2' })
    ).toBe('A-1');
  });

  it('does not let a blank nested token shadow a valid flat token', () => {
    expect(
      readMonnifyBillToken({ metaData: { token: '   ' }, token: 'B-2' })
    ).toBe('B-2');
  });

  it.each([
    {},
    { token: '  ' },
    { metaData: { token: '' }, token: null },
  ])('returns nothing for %j', (body) => {
    expect(readMonnifyBillToken(body)).toBeUndefined();
  });
});

describe('bugfix: placeholder tokens are not a delivered token', () => {
  it.each([
    '0',
    '-',
    'N/A',
    'n/a',
    'null',
    'None',
    '...',
  ])('ignores the placeholder %j', (token) => {
    expect(readMonnifyBillToken({ token })).toBeUndefined();
  });

  it('falls through to a real flat token behind a placeholder nested token', () => {
    expect(
      readMonnifyBillToken({ metaData: { token: 'N/A' }, token: 'ABCD-1234' })
    ).toBe('ABCD-1234');
  });

  it('keeps a real token', () => {
    expect(readMonnifyBillToken({ token: '3772-0340-4164' })).toBe(
      '3772-0340-4164'
    );
  });
});

describe('bugfix: more placeholder tokens are not a delivered token', () => {
  it.each([
    'TBD',
    'PENDING',
    'processing',
    'xxxx',
    'error',
    'Unknown',
    '0000',
    'dummy',
    'TEST',
  ])('ignores the placeholder %j', (token) => {
    expect(readMonnifyBillToken({ token })).toBeUndefined();
  });

  it('keeps a real token that merely contains a placeholder word', () => {
    expect(readMonnifyBillToken({ token: 'TEST-1234-5678' })).toBe(
      'TEST-1234-5678'
    );
  });
});
