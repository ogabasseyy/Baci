import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactPrivateValues } from './android-benchmark-redaction.mjs';

test('redacts literal, URL-encoded, base64 and line-wrapped private values', () => {
  const secret = 's3cr3t/value+with spaces';
  const base64 = Buffer.from(secret).toString('base64');
  const wrapped = secret.match(/.{1,6}/g)?.join('\n') ?? '';
  const output = [
    `literal=${secret}`,
    `url=${encodeURIComponent(secret)}`,
    `base64=${base64}`,
    `wrapped=${wrapped}`,
  ].join('\n');

  const redacted = redactPrivateValues(output, [secret]);

  assert.equal((redacted.match(/\[REDACTED\]/g) ?? []).length, 4);
  assert.doesNotMatch(redacted, /s3cr3t|s%33cr3t|czNjcjN0/);
});

test('leaves output unchanged when no private values are supplied', () => {
  assert.equal(redactPrivateValues('build failed', []), 'build failed');
});
