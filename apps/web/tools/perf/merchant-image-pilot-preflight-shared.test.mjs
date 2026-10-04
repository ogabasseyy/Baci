import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_DATETIME,
  ASSET_ID,
  fail,
  HEX64,
  isIntIn,
  isPlainObject,
  isRouteDatetime,
  pass,
  positionalHashesMatch,
  sha256Hex,
  TIER_FILE,
  UUID,
} from './merchant-image-pilot-preflight-shared.mjs';

describe('route-mirror patterns', () => {
  it('matches the route uuid contract incl. nil and max', () => {
    expect(UUID.test('6b5cb8a4-5575-456c-b936-8cdfae30db74')).toBe(true);
    expect(UUID.test('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(UUID.test('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true);
    expect(UUID.test('6b5cb8a4-5575-956c-b936-8cdfae30db74')).toBe(false);
    expect(UUID.test('not-a-uuid')).toBe(false);
    expect(UUID.test('')).toBe(false);
  });

  it('bounds asset ids to the route charset', () => {
    expect(ASSET_ID.test('logo-a_1.2-3')).toBe(true);
    expect(ASSET_ID.test('a'.repeat(128))).toBe(true);
    expect(ASSET_ID.test('')).toBe(false);
    expect(ASSET_ID.test('a'.repeat(129))).toBe(false);
    expect(ASSET_ID.test('../evil')).toBe(false);
    expect(ASSET_ID.test('has space')).toBe(false);
  });

  it('binds tier file names to hash and format', () => {
    const match = TIER_FILE.exec(`${'c'.repeat(64)}.avif`);
    expect(match?.[1]).toBe('c'.repeat(64));
    expect(match?.[2]).toBe('avif');
    expect(TIER_FILE.test(`${'c'.repeat(64)}.png`)).toBe(false);
    expect(TIER_FILE.test('short.avif')).toBe(false);
  });

  it('accepts offset datetimes and rejects naive forms', () => {
    const re = new RegExp(ACCEPTANCE_DATETIME);
    expect(re.test('2026-10-01T10:00:00Z')).toBe(true);
    expect(re.test('2026-10-01T10:00+01:00')).toBe(true);
    expect(re.test('2026-10-01T10:00:00.123Z')).toBe(true);
    expect(re.test('2026-10-01T10:00:00')).toBe(false);
    expect(re.test('2026-10-01')).toBe(false);
    expect(re.test('2026-10-01 10:00:00Z')).toBe(false);
  });
});

describe('isRouteDatetime', () => {
  it('checks real-calendar validity, not just shape', () => {
    expect(isRouteDatetime('2026-10-01T10:00:00Z')).toBe(true);
    expect(isRouteDatetime('2024-02-29T10:00:00Z')).toBe(true);
    expect(isRouteDatetime('2026-02-29T10:00:00Z')).toBe(false);
    expect(isRouteDatetime('2026-02-30T10:00:00Z')).toBe(false);
    expect(isRouteDatetime('2026-13-01T10:00:00Z')).toBe(false);
    expect(isRouteDatetime('not a date')).toBe(false);
    expect(isRouteDatetime(null)).toBe(false);
    expect(isRouteDatetime(undefined)).toBe(false);
  });
});

describe('check recording', () => {
  it('records passes and prefixed failures', () => {
    const checks = [];
    const failures = [];
    pass(checks, 'gate:ok');
    fail(checks, failures, 'gate:bad', 'detail here');
    expect(checks).toEqual([
      { name: 'gate:ok', ok: true },
      { detail: 'detail here', name: 'gate:bad', ok: false },
    ]);
    expect(failures).toEqual(['gate:bad: detail here']);
  });
});

describe('small predicates', () => {
  it('hashes bytes to lowercase hex', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(HEX64.test(sha256Hex(Buffer.from('')))).toBe(true);
  });

  it('bounds integers inclusively', () => {
    expect(isIntIn(1, 1, 3)).toBe(true);
    expect(isIntIn(3, 1, 3)).toBe(true);
    expect(isIntIn(0, 1, 3)).toBe(false);
    expect(isIntIn(1.5, 1, 3)).toBe(false);
    expect(isIntIn(Number.NaN, 1, 3)).toBe(false);
  });

  it('detects plain objects only', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });

  it('compares acceptance hashes positionally without dedupe or sort', () => {
    expect(positionalHashesMatch(['a', 'b'], ['a', 'b'])).toBe(true);
    // Same set, swapped positions: a sorted-set comparison would pass.
    expect(positionalHashesMatch(['a', 'b'], ['b', 'a'])).toBe(false);
    // Deduped capped rungs must not certify: lengths differ.
    expect(positionalHashesMatch(['a', 'a'], ['a'])).toBe(false);
    expect(positionalHashesMatch(['a'], ['a', 'b'])).toBe(false);
    expect(positionalHashesMatch(['a'], undefined)).toBe(false);
  });
});
