import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeText } from './sanitize.mjs';

const ZWSP = '​';

test('keeps ordinary markdown: code, links, lists and fences', () => {
  const input = 'Use `select(id)` here.\n\n```ts\nconst a = 1;\n```\n- see [docs](https://example.com/a)';
  assert.equal(sanitizeText(input), input);
});

test('neutralises @mentions and team mentions but not email addresses', () => {
  const out = sanitizeText('ping @octocat and @acme/security, mail ops@example.com');
  assert.ok(out.includes(`@${ZWSP}octocat`));
  assert.ok(out.includes(`@${ZWSP}acme/security`));
  assert.ok(out.includes('ops@example.com'));
});

test('removes markdown images, html images and html comments (exfiltration and marker forgery)', () => {
  const out = sanitizeText('a ![x](https://evil.test/p.png?d=1) b <img src="https://evil.test/x"> c <!-- gemini-code-review sha:abc --> d');
  assert.doesNotMatch(out, /evil\.test/);
  assert.doesNotMatch(out, /gemini-code-review/);
  assert.match(out, /a .* b .* c .* d/);
});

test('removes other html tags such as script and iframe', () => {
  const out = sanitizeText('x <script>alert(1)</script> y <iframe src="//e"></iframe> z');
  assert.doesNotMatch(out, /<script|<iframe/);
});

test('redacts well-known secret shapes before truncating', () => {
  const secrets = [
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    `AIza${'a'.repeat(35)}`,
    'AKIAABCDEFGHIJKLMNOP',
    'xoxb-1234567890-abcdefghij',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwx',
    `sk_live_${'a'.repeat(24)}`,
    `sk-${'b'.repeat(30)}`,
  ];
  for (const secret of secrets) {
    const out = sanitizeText(`value ${secret} end`);
    assert.ok(!out.includes(secret), `leaked ${secret.slice(0, 8)}`);
    assert.match(out, /\[redacted\]/);
  }
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
  assert.ok(!sanitizeText(`k ${pem} k`).includes('MIIEvQ'));
});

test('redacts key=value style secrets but keeps the key name', () => {
  const out = sanitizeText('API_KEY = "abcdEFGH12345678abcd" and password: hunter2hunter2hunter2');
  assert.match(out, /API_KEY/);
  assert.ok(!out.includes('abcdEFGH12345678abcd'));
  assert.ok(!out.includes('hunter2hunter2hunter2'));
});

test('truncates to the limit with a marker and never splits a secret into the kept part', () => {
  const long = `${'x'.repeat(50)} ghp_abcdefghijklmnopqrstuvwxyz0123456789 ${'y'.repeat(500)}`;
  const out = sanitizeText(long, { max: 80 });
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('ghp_'));
});

test('accepts non-string input without throwing', () => {
  assert.equal(sanitizeText(undefined), '');
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText(42), '42');
});
