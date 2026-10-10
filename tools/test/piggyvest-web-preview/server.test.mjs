import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';

test('server module imports without listening and exports explicit startup', () => {
  assert.equal(typeof startPreview, 'function');
});

test('running loopback preview serves synthetic HTML and denies files outside its allowlist', async () => {
  const response = await fetch('http://127.0.0.1:4179/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Synthetic savings QA/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(
    response.headers.get('content-security-policy'),
    /connect-src 'self' ws:\/\/127.0.0.1:4179/
  );
  const outsideFile = fileURLToPath(
    new URL('../../../README.md', import.meta.url)
  );
  const denied = await fetch(`http://127.0.0.1:4179/@fs${outsideFile}`);
  assert.equal(denied.status, 403);
});
