import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  redactPrivateValues,
  redactPrivateValuesAndLimit,
} from './android-benchmark-redaction.mjs';

test('redacts literal, URL-encoded, base64 and line-wrapped private values', () => {
  const secret = 's3cr3t/value+with spaces';
  const base64 = Buffer.from(secret).toString('base64');
  const lowercaseEncoded = encodeURIComponent(secret).replace(
    /%[0-9A-F]{2}/g,
    (escape) => escape.toLowerCase()
  );
  const wrapped = secret.match(/.{1,6}/g)?.join('\n') ?? '';
  const output = [
    `literal=${secret}`,
    `url=${encodeURIComponent(secret)}`,
    `lowercase-url=${lowercaseEncoded}`,
    `base64=${base64}`,
    `wrapped=${wrapped}`,
  ].join('\n');

  const redacted = redactPrivateValues(output, [secret]);

  assert.equal((redacted.match(/\[REDACTED\]/g) ?? []).length, 5);
  assert.doesNotMatch(redacted, /s3cr3t|s%33cr3t|czNjcjN0/);
});

test('leaves output unchanged when no private values are supplied', () => {
  assert.equal(redactPrivateValues('build failed', []), 'build failed');
});

test('redacts padded and unpadded base64url secrets containing URL-safe symbols', () => {
  const secret = 'ÿÿ';
  const unpadded = Buffer.from(secret).toString('base64url');
  const padded = `${unpadded}${'='.repeat((4 - (unpadded.length % 4)) % 4)}`;
  const redacted = redactPrivateValues(
    `padded=${padded}\nunpadded=${unpadded}`,
    [secret]
  );

  assert.equal(padded, 'w7_Dvw==');
  assert.equal(unpadded, 'w7_Dvw');
  assert.equal((redacted.match(/\[REDACTED\]/g) ?? []).length, 2);
  assert.doesNotMatch(redacted, /w7_Dv8O/);
});

test('redacts multiline secrets before truncating a diagnostic at the 4 MiB cutoff', () => {
  const maxBytes = 4 * 1024 * 1024;
  const secret = 'private-value-across-cutoff';
  const wrapped = secret.match(/.{1,5}/g)?.join('\n') ?? '';
  const output = `${'x'.repeat(maxBytes - 8)}\n${wrapped}\ntrailing output`;

  const diagnostic = redactPrivateValuesAndLimit(output, [secret], maxBytes);

  assert.ok(Buffer.byteLength(diagnostic) <= maxBytes);
  assert.doesNotMatch(diagnostic, /private|value|across|cutoff/);
});


test('keeps wrapped-pattern work bounded for long secrets in large logs', () => {
  const secret = 'x'.repeat(2048);
  const wrappedSecret = secret.match(/.{1,64}/g)?.join('\n') ?? '';
  const log = `${'noise\n'.repeat(100_000)}${wrappedSecret}`;
  const start = performance.now();
  const redacted = redactPrivateValues(log, [secret]);

  assert.ok(performance.now() - start < 2000);
  assert.ok(redacted.endsWith('[REDACTED]'));
});
