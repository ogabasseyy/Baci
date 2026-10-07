import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewConfig } from './config.mjs';

test('isolates preview configuration from env, public assets and remote access', () => {
  const config = createPreviewConfig({ postcssPlugin: 'synthetic-test' });
  assert.equal(config.configFile, false);
  assert.equal(config.envFile, false);
  assert.deepEqual(config.envPrefix, []);
  assert.equal(config.publicDir, false);
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.server.strictPort, true);
  assert.equal(config.server.cors, false);
  assert.equal(config.server.fs.strict, true);
  assert.ok(config.server.fs.deny.includes('**/.env*'));
  assert.match(
    config.server.headers['Content-Security-Policy'],
    /form-action 'none'/
  );
});
