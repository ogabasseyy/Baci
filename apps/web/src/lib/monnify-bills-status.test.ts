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
