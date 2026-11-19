import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const script = new URL(
  '../scripts/piggyvest-egress-relay-smoke.mjs',
  import.meta.url
).pathname;
const SECRET = 'test-relay-secret-0123456789abcdef0123';

function run(url) {
  return spawnSync(process.execPath, [script], {
    env: {
      PATH: process.env.PATH,
      PIGGYVEST_EGRESS_RELAY_URL: url,
      PIGGYVEST_EGRESS_RELAY_SECRET: SECRET,
      PIGGYVEST_SECRET_KEY: 'pv-key-do-not-print',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('relay smoke script URL guard', () => {
  for (const url of [
    'http://relay.invalid',
    'http://203.0.113.9',
    'ftp://relay.invalid',
    'https://user:pass@relay.invalid',
    'not a url',
  ]) {
    it(`refuses to send the key to ${url}`, () => {
      const result = run(url);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /PIGGYVEST_EGRESS_RELAY_URL/);
      assert.doesNotMatch(result.stdout + result.stderr, /pv-key-do-not-print/);
    });
  }
});
