import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveHostedStagingPushConfig } from './resolve-config.mjs';

test('offline resolution never loads dotenv credentials and preserves caller environment', () => {
  const environment = Object.freeze({
    NODE_ENV: 'production',
    EAS_BUILD: 'true',
    EAS_BUILD_PROFILE: 'production',
  });
  const pins = JSON.parse(
    readFileSync(
      new URL(
        '../../../apps/mobile-storefront/config/hosted-storefront-pins.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  assert.throws(
    () => resolveHostedStagingPushConfig(environment, pins),
    /Missing required Facebook/
  );
  assert.equal(environment.NODE_ENV, 'production');
  assert.equal(environment.STOREFRONT_FACEBOOK_CLIENT_TOKEN, undefined);
});

test('regression: the source resolver supports a checkout path containing spaces and percent characters', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-resolver-path-'));
  try {
    const checkout = join(directory, 'source checkout %');
    symlinkSync(
      fileURLToPath(new URL('../../../', import.meta.url)),
      checkout,
      'dir'
    );
    const moduleUrl = pathToFileURL(
      join(checkout, 'tools/staging/mobile-push/resolve-config.mjs')
    ).href;
    const script = `
      const { resolveHostedStagingPushConfig } = await import(${JSON.stringify(moduleUrl)});
      const config = resolveHostedStagingPushConfig({
        NODE_ENV: 'test',
        STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
        STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
        EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key'
      }, {});
      process.stdout.write(config.name);
    `;
    const result = spawnSync(
      process.execPath,
      ['--preserve-symlinks', '--input-type=module', '--eval', script],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Ogabassey');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('offline resolution returns the ordinary manifest without reading real dotenv files', () => {
  const paths = [];
  const config = resolveHostedStagingPushConfig(
    {
      NODE_ENV: 'development',
      STOREFRONT_FACEBOOK_APP_ID: 'synthetic-id',
      STOREFRONT_FACEBOOK_CLIENT_TOKEN: 'synthetic-token',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'synthetic-key',
    },
    {},
    (path) => paths.push(path)
  );
  assert.equal(config.name, 'Ogabassey');
  assert.deepEqual(paths, [
    fileURLToPath(
      new URL('../../../apps/mobile-storefront/.env', import.meta.url)
    ),
  ]);
});
