import { describe, expect, it } from 'vitest';
import { isEntryList } from './is-entry-list';

describe('isEntryList', () => {
  it.each([
    [[]],
    [[['token', 'abc']]],
    [
      [
        ['a', '1'],
        ['a', '2'],
      ],
    ],
    [[['', '']]],
  ])('accepts a list of name/value string pairs %j', (value) => {
    expect(isEntryList(value)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'token=abc'],
    ['an object', { token: 'abc' }],
    ['a pair of the wrong length (1)', [['token']]],
    ['a pair of the wrong length (3)', [['token', 'abc', 'x']]],
    ['a non-string value', [['token', 1]]],
    ['a non-string name', [[1, 'abc']]],
    ['a null value', [['token', null]]],
    ['a non-array entry', ['token']],
    ['one bad entry among good ones', [['a', '1'], ['b']]],
  ])('rejects %s', (_label, value) => {
    expect(isEntryList(value)).toBe(false);
  });
});
