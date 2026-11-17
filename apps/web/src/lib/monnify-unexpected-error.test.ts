import { describe, expect, it } from 'vitest';
import {
  isMonnifyUnexpectedErrorCode,
  reportsMonnifyUnexpectedError,
} from './monnify-unexpected-error';

describe('isMonnifyUnexpectedErrorCode', () => {
  it.each(['99', ' 99 ', '099', 99])('reads %j as code 99', (code) => {
    expect(isMonnifyUnexpectedErrorCode(code)).toBe(true);
  });

  it.each([
    '01',
    '199',
    '990',
    '',
    null,
    undefined,
    {},
  ])('does not read %j as code 99', (code) => {
    expect(isMonnifyUnexpectedErrorCode(code)).toBe(false);
  });
});

describe('reportsMonnifyUnexpectedError', () => {
  it.each([
    JSON.stringify({ responseCode: '99', responseMessage: 'x' }),
    JSON.stringify({ responseCode: 99 }),
    JSON.stringify({ responseCode: ' 099 ' }),
    'Code 99: Insufficient wallet balance',
    'response_code=99',
  ])('reads %s as code 99', (text) => {
    expect(reportsMonnifyUnexpectedError(text)).toBe(true);
  });

  it.each([
    JSON.stringify({ responseCode: '01', responseMessage: 'Low balance' }),
    'Code 199',
    'Insufficient wallet balance',
    '',
    null,
  ])('does not read %s as code 99', (text) => {
    expect(reportsMonnifyUnexpectedError(text)).toBe(false);
  });
});
