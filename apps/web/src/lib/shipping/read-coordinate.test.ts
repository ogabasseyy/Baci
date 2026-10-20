import { describe, expect, it } from 'vitest';
import { readCoordinate } from './read-coordinate';

describe('readCoordinate', () => {
  it.each([null, undefined])('reads %s as absent', (value) => {
    expect(readCoordinate(value, -90, 90)).toEqual({ status: 'absent' });
  });

  it.each([
    [0, 0],
    [-90, -90],
    [90, 90],
    [' 6.6018 ', 6.6018],
    ['0', 0],
  ])('reads numeric coordinate %j without losing zero or bounds', (input, value) => {
    expect(readCoordinate(input, -90, 90)).toEqual({ status: 'valid', value });
  });

  it.each([
    '',
    '  ',
    'invalid',
    true,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -90.001,
    90.001,
  ])('rejects malformed or out-of-range latitude %j', (input) => {
    expect(readCoordinate(input, -90, 90)).toEqual({ status: 'invalid' });
  });

  it('uses the caller longitude bounds', () => {
    expect(readCoordinate('180', -180, 180)).toEqual({
      status: 'valid',
      value: 180,
    });
    expect(readCoordinate(-180.001, -180, 180)).toEqual({ status: 'invalid' });
  });
});
