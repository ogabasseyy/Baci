import { assertSafeEvidenceOutput } from './assert-safe-evidence-output';

const SHA_A = `sha256:${'a'.repeat(64)}`;

describe('evidence output scanner', () => {
  it.each([
    'http://[::1]/private',
    'http://[fe80::1]/link-local',
    'http://[fd00::1]/private',
    'http://merchant.local/private',
  ])('rejects private IPv6 and local host output %s', (sourceUrl) => {
    expect(() => assertSafeEvidenceOutput({ sourceUrl })).toThrow(
      'Invalid evidence manifest'
    );
  });

  it.each([
    ['credential-shaped value', { note: 'Bearer abcdefghijklmnop' }],
    ['email', { note: 'person@example.com' }],
    ['private host', { sourceUrl: 'http://127.0.0.1/private' }],
    [
      'IPv4 mapped loopback',
      { sourceUrl: 'http://[::ffff:127.0.0.1]/private' },
    ],
    ['Supabase project host', { host: 'abcdefghijklmnopqrst.supabase.co' }],
    ['raw body key', { body: '{}' }],
    ['hyphenated api key', { 'api-key': 'sensitive' }],
    ['hyphenated raw source', { 'raw-source': 'sensitive' }],
    ['raw header key', { headers: {} }],
    ['raw source digest key', { rawSourceDigest: SHA_A }],
    ['environment key', { environment: 'production' }],
  ])('rejects recursive unsafe output directly: %s', (_label, bait) => {
    expect(() => assertSafeEvidenceOutput({ safe: bait })).toThrow(
      'Invalid evidence manifest'
    );
  });
});
