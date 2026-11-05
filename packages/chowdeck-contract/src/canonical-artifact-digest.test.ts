import {
  canonicalizeArtifact,
  digestArtifact,
  parseCanonicalJson,
} from './canonical-artifact-digest';

describe('canonical artifact digest', () => {
  it('serializes the accepted RFC 8785 subset deterministically', () => {
    const artifact = {
      z: true,
      integer: 9_007_199_254_740_991,
      literals: [null, false],
      string: `€$A'B"\\"/`,
    };

    expect(canonicalizeArtifact(artifact)).toBe(
      `{"integer":9007199254740991,"literals":[null,false],"string":"€$A'B\\"\\\\\\"/","z":true}`
    );
    expect(digestArtifact(artifact)).toBe(
      'sha256:e23abf84a73b692d7d5702f6f04828b3c8a60fc8bb4e3928c46fda000f36aa55'
    );
  });

  it.each([
    ['fractional number', 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['negative zero', -0],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects a %s from the strict evidence subset', (_label, value) => {
    expect(() => canonicalizeArtifact({ value })).toThrow(
      'not canonical evidence'
    );
  });

  it.each([
    ['non-NFC text', 'e\u0301'],
    ['NUL', 'safe\u0000unsafe'],
    ['control text', 'safe\u007funsafe'],
    ['lone high surrogate', '\ud800'],
    ['lone low surrogate', '\udc00'],
  ])('rejects %s without normalizing it', (_label, value) => {
    expect(() => canonicalizeArtifact({ value })).toThrow(
      'not canonical evidence'
    );
  });

  it('accepts composed Unicode and valid surrogate pairs', () => {
    expect(canonicalizeArtifact({ emoji: '😀', text: 'é' })).toBe(
      '{"emoji":"😀","text":"é"}'
    );
  });

  it('rejects duplicate object keys before JSON validation', () => {
    expect(() => parseCanonicalJson('{"claim":1,"claim":2}')).toThrow(
      'not canonical evidence'
    );
  });

  it('retains an own __proto__ JSON key without changing object semantics', () => {
    const parsed = parseCanonicalJson('{"__proto__":1}');

    expect(canonicalizeArtifact(parsed)).toBe('{"__proto__":1}');
  });

  it('rejects sparse arrays instead of emitting invalid JSON', () => {
    expect(() => canonicalizeArtifact(new Array(2))).toThrow(
      'not canonical evidence'
    );
  });

  it('rejects non-JSON whitespace instead of accepting Unicode spacing', () => {
    expect(() => parseCanonicalJson('{\u00a0"claim":1}')).toThrow(
      'not canonical evidence'
    );
  });

  it('omits only the requested top-level digest field', () => {
    const artifact = {
      digest: 'sha256:discarded',
      nested: { digest: 'retained' },
      value: 1,
    };

    expect(canonicalizeArtifact(artifact, { omitTopLevelKey: 'digest' })).toBe(
      '{"nested":{"digest":"retained"},"value":1}'
    );
  });
});
