import { describe, expect, it } from 'vitest';
import { RECORDING_ACCOUNT_EMAIL, SANDBOX_ORIGIN } from './constants';
import {
  assertNoRecordingAccount,
  assertSandboxBaseUrl,
  assertTestKey,
  classifyKey,
  containsRecordingAccount,
  HarnessRefusal,
} from './safety-guards';

function refusalCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

describe('assertSandboxBaseUrl', () => {
  it('accepts exactly the sandbox origin, with or without a trailing slash', () => {
    expect(assertSandboxBaseUrl('https://staging.piggyvest.business')).toBe(
      SANDBOX_ORIGIN
    );
    expect(assertSandboxBaseUrl('https://staging.piggyvest.business/')).toBe(
      SANDBOX_ORIGIN
    );
    expect(assertSandboxBaseUrl('  https://STAGING.piggyvest.business ')).toBe(
      SANDBOX_ORIGIN
    );
  });

  it.each([
    ['production host', 'https://api.piggyvest.business'],
    ['bare apex', 'https://piggyvest.business'],
    ['plain http', 'http://staging.piggyvest.business'],
    ['look-alike suffix', 'https://staging.piggyvest.business.evil.example'],
    ['look-alike prefix', 'https://evil-staging.piggyvest.business'],
    ['userinfo smuggling', 'https://staging.piggyvest.business@evil.example'],
    ['credentials', 'https://user:pw@staging.piggyvest.business'],
    ['custom port', 'https://staging.piggyvest.business:8443'],
    ['path suffix', 'https://staging.piggyvest.business/api/v1'],
    ['query suffix', 'https://staging.piggyvest.business/?x=1'],
    ['fragment', 'https://staging.piggyvest.business/#x'],
    ['trailing dot host', 'https://staging.piggyvest.business.'],
    [
      'backslash host trick',
      'https://evil.example\\@staging.piggyvest.business',
    ],
    ['embedded whitespace', 'https://staging.piggyvest.business /'],
    ['ipv4 literal', 'https://127.0.0.1'],
    ['localhost', 'http://localhost:3000'],
    ['empty string', ''],
    ['not a url', 'staging.piggyvest.business'],
  ])('refuses %s', (_label, url) => {
    expect(refusalCode(() => assertSandboxBaseUrl(url))).toBe(
      'BASE_URL_NOT_SANDBOX'
    );
  });

  it('refuses non-string input', () => {
    expect(refusalCode(() => assertSandboxBaseUrl(undefined as never))).toBe(
      'BASE_URL_NOT_SANDBOX'
    );
  });
});

describe('classifyKey / assertTestKey', () => {
  it('classifies by the prefix that precedes the secret body', () => {
    expect(classifyKey('test_key_abc123XYZ')).toBe('test');
    expect(classifyKey('live_key_abc123XYZ')).toBe('live');
    expect(classifyKey('sk_live_abc123')).toBe('live');
    expect(classifyKey('test_live_key_abc')).toBe('live');
    expect(classifyKey('abc123')).toBe('unknown');
  });

  it('accepts a test key', () => {
    expect(() => assertTestKey('test_key_AbC123xyz')).not.toThrow();
    expect(() => assertTestKey('test_key_AbC_123-xyz')).not.toThrow();
  });

  it.each([
    ['live key', 'live_key_AbC123xyz', 'KEY_NOT_TEST'],
    ['paystack-style live key', 'sk_live_AbC123xyz', 'KEY_NOT_TEST'],
    ['no recognisable prefix', 'AbC123xyz', 'KEY_NOT_TEST'],
    ['test and live both in prefix', 'test_live_key_AbC', 'KEY_NOT_TEST'],
    ['empty prefix body', 'test_key_', 'KEY_NOT_TEST'],
    ['whitespace inside', 'test_key_abc def', 'KEY_NOT_TEST'],
    ['newline (header injection)', 'test_key_abc\nX-Evil: 1', 'KEY_NOT_TEST'],
    ['surrounding whitespace', ' test_key_abc123 ', 'KEY_NOT_TEST'],
    ['empty', '', 'KEY_MISSING'],
    ['undefined', undefined, 'KEY_MISSING'],
  ])('refuses %s', (_label, key, code) => {
    expect(refusalCode(() => assertTestKey(key as string | undefined))).toBe(
      code
    );
  });

  it('never leaks the key in the refusal message', () => {
    try {
      assertTestKey('live_key_SuperSecret123');
      throw new Error('expected refusal');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('SuperSecret123');
    }
  });
});

describe('recording-account guard', () => {
  it('detects the exact recording email', () => {
    expect(containsRecordingAccount(RECORDING_ACCOUNT_EMAIL)).toBe(true);
  });

  it.each([
    ['upper case', 'BACI-RECORDING-20261013@EXAMPLE.COM'],
    ['plus addressed', 'baci-recording-20261013+x@example.com'],
    ['url encoded', 'baci-recording-20261013%40example.com'],
    ['double encoded', 'baci-recording-20261013%2540example.com'],
    ['dots and dashes shuffled', 'baci.recording.20261013@example.com'],
    ['embedded in a sentence', 'user=baci-recording-20261013 failed'],
    ['inside a nested object value', { a: [{ b: 'baci-recording-2026' }] }],
    ['inside an object key', { 'baci-recording-20261013@example.com': 1 }],
    ['inside a json string', '{"email":"baci-recording-20261013@example.com"}'],
  ])('detects %s', (_label, value) => {
    expect(containsRecordingAccount(value)).toBe(true);
    expect(refusalCode(() => assertNoRecordingAccount('request', value))).toBe(
      'RECORDING_ACCOUNT'
    );
  });

  it('does not flag unrelated synthetic identities', () => {
    expect(
      containsRecordingAccount({
        email: 'synthetic+0123456789ab@example.test',
        note: 'recording of the demo',
      })
    ).toBe(false);
    expect(() => assertNoRecordingAccount('x', 'hello world')).not.toThrow();
  });

  it('never echoes the matched value in the refusal', () => {
    try {
      assertNoRecordingAccount('allowlist', RECORDING_ACCOUNT_EMAIL);
      throw new Error('expected refusal');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('baci-recording');
      expect(String((error as Error).message)).toContain('allowlist');
    }
  });
});
