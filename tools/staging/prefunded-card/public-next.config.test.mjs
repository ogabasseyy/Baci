import assert from 'node:assert/strict';
import test from 'node:test';
import configuration from './public-next.config.mjs';

test('keeps staging auth configuration runtime-only without relaxing other definitions', () => {
  const definitions = {
    __NEXT_DEFINE_ENV: true,
    'process.env.NEXT_PUBLIC_SUPABASE_URL': '"build-url"',
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"synthetic-build-only"',
    'process.env.NEXT_PUBLIC_APP_URL': '"build-origin"',
    'process.env.NODE_ENV': '"production"',
  };
  const config = { plugins: [{ definitions }] };
  assert.equal(configuration.webpack(config), config);
  assert.deepEqual(definitions, {
    __NEXT_DEFINE_ENV: true,
    'process.env.NODE_ENV': '"production"',
  });
  assert.equal(configuration.assetPrefix, '/savings/card-assets');
  assert.equal(configuration.output, 'standalone');
  assert.equal(configuration.poweredByHeader, false);
  assert.equal(configuration.typescript.ignoreBuildErrors, undefined);
});

test('refuses a compiler whose environment definition contract changed', () => {
  assert.throws(() => configuration.webpack({ plugins: [] }));
  assert.throws(() =>
    configuration.webpack({ plugins: [{ definitions: {} }] })
  );
});
