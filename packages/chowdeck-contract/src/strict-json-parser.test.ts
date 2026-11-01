import { parseStrictJson } from './strict-json-parser';

describe('strict JSON parser', () => {
  it('preserves __proto__ as an own data property on a null-prototype object', () => {
    const parsed = parseStrictJson('{"__proto__":{"nested":true}}');

    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.hasOwn(parsed as object, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value).toEqual(
      { nested: true }
    );
  });

  it('rejects duplicate keys and whitespace outside the JSON grammar', () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow(
      'not canonical evidence'
    );
    expect(() => parseStrictJson('{\v"a":1}')).toThrow(
      'not canonical evidence'
    );
  });
  it.each([
    '',
    '{',
    '[1,]',
    '{"a":1,}',
    '01',
    '-',
    '1.',
    '"unterminated',
    '"raw\u0001control"',
    '[] x',
    'nul',
  ])('rejects malformed JSON %j', (input) =>
    expect(() => parseStrictJson(input)).toThrow('not canonical evidence'));
  it('enforces its nesting depth limit', () => {
    expect(() =>
      parseStrictJson(`${'['.repeat(32)}0${']'.repeat(32)}`)
    ).not.toThrow();
    expect(() =>
      parseStrictJson(`${'['.repeat(33)}0${']'.repeat(33)}`)
    ).toThrow('capture limit exceeded');
  });
});
