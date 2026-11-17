import { describe, expect, it } from 'vitest';
import { isMonnifyUnexpectedErrorCode } from './monnify-unexpected-error';

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
