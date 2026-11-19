import { describe, expect, it } from 'vitest';
import {
  PATH_TOKEN_PLACEHOLDER,
  redactPathTokens,
  SENSITIVE_PATH_PREFIXES,
  SENSITIVE_PATH_REGEX_SOURCE,
} from './sensitive-url-paths';

describe('redactPathTokens', () => {
  it.each([
    ['/receipts/claim/secret', '/receipts/claim/[redacted]'],
    [
      'https://shop.example/acme/receipts/claim/secret?a=1',
      'https://shop.example/acme/receipts/claim/[redacted]?a=1',
    ],
    ['/receipts/claim/secret/extra', '/receipts/claim/[redacted]/extra'],
    ['/receipts/claim/secret#frag', '/receipts/claim/[redacted]#frag'],
    ['/Receipts/Claim/secret', '/Receipts/Claim/[redacted]'],
    ['/receipts/claim/[redacted]', '/receipts/claim/[redacted]'],
  ])('redacts the token segment of %s', (input, expected) => {
    expect(redactPathTokens(input)).toBe(expected);
  });

  it('redacts every occurrence in one string', () => {
    expect(redactPathTokens('/receipts/claim/a?next=/receipts/claim/b')).toBe(
      '/receipts/claim/[redacted]?next=/receipts/claim/[redacted]'
    );
  });

  it.each([
    '/receipts/claim',
    '/receipts/claim/',
    '/receipts/list/abc',
    '/other/receipts',
    '',
  ])('leaves %j unchanged', (input) => {
    expect(redactPathTokens(input)).toBe(input);
  });
});

describe('path token policy', () => {
  it('lists the receipt claim prefix and a regex source covering it', () => {
    expect(SENSITIVE_PATH_PREFIXES).toContain('/receipts/claim/');
    expect(PATH_TOKEN_PLACEHOLDER).toBe('[redacted]');
    expect(
      new RegExp(SENSITIVE_PATH_REGEX_SOURCE, 'i').test('/receipts/claim/x')
    ).toBe(true);
  });

  it('escapes regex characters in a prefix', () => {
    expect(SENSITIVE_PATH_REGEX_SOURCE).toContain('\\/'.replace('\\', ''));
    expect(
      new RegExp(SENSITIVE_PATH_REGEX_SOURCE).test('/receiptsXclaim/x')
    ).toBe(false);
  });
});
