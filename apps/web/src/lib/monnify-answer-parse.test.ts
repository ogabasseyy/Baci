import { describe, expect, it } from 'vitest';
import { parseMonnifyAnswer } from './monnify-answer-parse';

describe('parseMonnifyAnswer', () => {
  it('parses a JSON object', () => {
    expect(parseMonnifyAnswer('{"duplicate":false}')).toEqual({
      duplicate: false,
    });
  });

  it('parses a form-encoded body', () => {
    expect(
      parseMonnifyAnswer('isFailed=true&message=Insufficient+wallet%20balance')
    ).toEqual({ isFailed: true, message: 'Insufficient wallet balance' });
  });

  it('parses "key: value; key=value" pairs', () => {
    expect(parseMonnifyAnswer('duplicate: false; message=Low')).toEqual({
      duplicate: false,
      message: 'Low',
    });
  });

  it.each([
    'Insufficient wallet balance',
    'Insufficient wallet balance; vendReference=MFBP-1',
    '',
    '42',
  ])('returns null for plain text %j', (body) => {
    expect(parseMonnifyAnswer(body)).toBeNull();
  });
});
