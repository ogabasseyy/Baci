import { decodeBase64UrlToUtf8 } from './base64url';

const encode = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64url');

it('decodes plain and UTF-8 payloads without a global atob', () => {
  expect(decodeBase64UrlToUtf8(encode('{"ok":true}'))).toBe('{"ok":true}');
  expect(decodeBase64UrlToUtf8(encode('{"name":"héllo ✓"}'))).toBe(
    '{"name":"héllo ✓"}'
  );
});

it('accepts unpadded and padded input and the url-safe alphabet', () => {
  const encoded = encode('subjects?_d=1');
  expect(decodeBase64UrlToUtf8(encoded)).toBe('subjects?_d=1');
  const padded = Buffer.from('subjects?_d=1', 'utf8').toString('base64');
  expect(decodeBase64UrlToUtf8(padded)).toBe('subjects?_d=1');
});

it('rejects malformed input instead of guessing', () => {
  expect(() => decodeBase64UrlToUtf8('a!b=')).toThrow(
    'Invalid base64url value'
  );
  expect(() => decodeBase64UrlToUtf8('%E0%A4%A')).toThrow();
});
