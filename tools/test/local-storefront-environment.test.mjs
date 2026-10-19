import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildLocalStorefrontEnvironment } from './local-storefront-environment.mjs';

function fixtureKey(payload = {}, header = {}) {
  return [
    Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header })
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({ iss: 'supabase-demo', role: 'anon', ...payload })
    ).toString('base64url'),
    Buffer.alloc(32).toString('base64url'),
  ].join('.');
}

function options(overrides = {}) {
  return {
    apiOrigin: 'http://192.168.100.70:4191',
    supabaseOrigin: 'http://192.168.100.70:54321',
    supabaseAnonKey: fixtureKey(),
    token: 'a'.repeat(48),
    expectedAuthIssuer: 'http://127.0.0.1:55431/auth/v1',
    merchantId: '10000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

test('pins local origins and both key precedence paths without changing the caller environment', () => {
  const source = Object.freeze({
    PATH: '/bin',
    HOME: '/tmp',
    TMPDIR: '/tmp',
    USER: 'local',
    SHELL: '/bin/sh',
    LANG: 'en_US.UTF-8',
    EXPO_PUBLIC_PHONE_QA: '1',
    EXPO_PUBLIC_PHONE_QA_TOKEN: 'forbidden',
    EXPO_PUBLIC_API_URL: 'https://production.invalid',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'forbidden',
    SUPABASE_SERVICE_ROLE_KEY: 'forbidden',
    EXPO_PUBLIC_PAYSTACK_KEY: 'forbidden',
    EXPO_PUBLIC_POSTHOG_API_KEY: 'forbidden',
    STOREFRONT_TIKTOK_APP_SECRET: 'forbidden',
    NODE_OPTIONS: '--require forbidden',
    NODE_PATH: '/forbidden',
    DOTENV_KEY: 'forbidden',
    EXPO_TOKEN: 'forbidden',
    HTTP_PROXY: 'forbidden',
    EXPO_NO_CLIENT_ENV_VARS: '1',
    CI: '1',
    NODE_ENV: 'production',
    EAS_BUILD: 'true',
    UNKNOWN_FUTURE_SECRET: 'forbidden',
  });
  const { environment } = buildLocalStorefrontEnvironment(options(), source);
  assert.equal(environment.PATH, '/bin');
  assert.equal(environment.EXPO_PUBLIC_API_URL, options().apiOrigin);
  assert.equal(environment.EXPO_PUBLIC_STOREFRONT_API_URL, options().apiOrigin);
  assert.equal(environment.EXPO_PUBLIC_SUPABASE_URL, options().supabaseOrigin);
  assert.equal(environment.EXPO_PUBLIC_SUPABASE_ANON_KEY, fixtureKey());
  assert.equal(environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, fixtureKey());
  assert.equal(environment.NODE_ENV, 'development');
  assert.equal(environment.EXPO_PUBLIC_PHONE_QA, '0');
  assert.equal(environment.EXPO_PUBLIC_LOCAL_STOREFRONT, '1');
  assert.equal(environment.EXPO_NO_DOTENV, '1');
  assert.equal(environment.EXPO_NO_TELEMETRY, '1');
  assert.equal(environment.EXPO_OFFLINE, '1');
  assert.equal(environment.EXPO_PUBLIC_QUIZ_ADS_ENABLED, 'false');
  assert.equal(environment.EXPO_PUBLIC_POSTHOG_API_KEY, '');
  assert.equal(environment.EXPO_PUBLIC_SENTRY_DSN, '');
  assert.equal(environment.STOREFRONT_FACEBOOK_APP_ID, '');
  assert.equal(environment.STOREFRONT_FACEBOOK_CLIENT_TOKEN, '');
  assert.equal(environment.STOREFRONT_TIKTOK_APP_SECRET, '');
  assert.equal(environment.EXPO_PUBLIC_POSTHOG_HOST, options().apiOrigin);
  assert.equal(environment.EXPO_PUBLIC_MERCHANT_DOMAIN, '192.168.100.70:4191');
  assert.ok(!JSON.stringify(environment).includes('forbidden'));
  assert.equal(environment.EXPO_NO_CLIENT_ENV_VARS, undefined);
  assert.equal(environment.CI, undefined);
  assert.equal(environment.EAS_BUILD, undefined);
  assert.equal(source.EXPO_PUBLIC_PHONE_QA, '1');
  assert.ok(Object.isFrozen(environment));
});

test('does not read ambient process.env or inherited object properties', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;
  try {
    process.env.EXPO_PUBLIC_API_URL = 'https://production.invalid';
    const source = Object.create({
      HOME: '/inherited',
      EXPO_TOKEN: 'forbidden',
    });
    source.PATH = '/bin\ninjected';
    assert.equal(
      buildLocalStorefrontEnvironment(options(), source).environment.HOME,
      undefined
    );
    assert.equal(
      buildLocalStorefrontEnvironment(options(), source).environment.PATH,
      undefined
    );
    assert.equal(
      buildLocalStorefrontEnvironment(options()).environment.HOME,
      undefined
    );
    assert.equal(
      buildLocalStorefrontEnvironment(options()).environment
        .EXPO_PUBLIC_API_URL,
      options().apiOrigin
    );
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
  }
});

for (const origin of [
  'http://10.0.0.2:3000',
  'http://172.16.0.2:3000',
  'https://172.31.255.254:8443/',
  'http://192.168.0.2:3000/',
]) {
  test(`accepts explicit RFC1918 origin ${origin}`, () => {
    assert.equal(
      buildLocalStorefrontEnvironment(options({ apiOrigin: origin }))
        .environment.EXPO_PUBLIC_API_URL,
      new URL(origin).origin
    );
  });
}

for (const origin of [
  undefined,
  '',
  'https://production.supabase.co:443',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://0.0.0.0:3000',
  'http://8.8.8.8:3000',
  'http://169.254.169.254:80',
  'http://172.15.0.2:3000',
  'http://172.32.0.2:3000',
  'http://192.169.0.2:3000',
  'http://[::1]:3000',
  'http://192.168.1.2',
  'http://192.168.1.2:0',
  'http://192.168.1.2:65536',
  'http://192.168.1.2:3000/path',
  'http://192.168.1.2:3000?key=secret',
  'http://192.168.1.2:3000#fragment',
  'http://user:secret@192.168.1.2:3000',
  'http://192.168.1.2.evil.test:3000',
  'http://0xc0a80102:3000',
  'http://192.168.001.2:3000',
  'http://3232235778:3000',
  ' http://192.168.1.2:3000',
  'ftp://192.168.1.2:3000',
]) {
  test(`rejects unsafe origin ${String(origin)}`, () => {
    for (const name of ['apiOrigin', 'supabaseOrigin']) {
      assert.throws(
        () => buildLocalStorefrontEnvironment(options({ [name]: origin })),
        /private IPv4 LAN/
      );
    }
  });
}

test('requires explicit settings and separate API/Supabase origins', () => {
  assert.throws(() => buildLocalStorefrontEnvironment(), /apiOrigin/);
  assert.throws(
    () =>
      buildLocalStorefrontEnvironment(
        options({ supabaseOrigin: `${options().apiOrigin}/` })
      ),
    /distinct origins/
  );
});

for (const key of [
  undefined,
  '',
  'sb_secret_private',
  'sb_publishable_cloud',
  'not-a-jwt',
  fixtureKey({ role: 'service_role' }),
  fixtureKey({ role: 'authenticated' }),
  fixtureKey({ iss: 'supabase' }),
  fixtureKey({ ref: 'hosted-project' }),
  fixtureKey({ project_ref: 'hosted-project' }),
  fixtureKey({}, { alg: 'none' }),
  fixtureKey({}, { typ: 'other' }),
  `${fixtureKey()}=`,
  `${fixtureKey()}\n`,
  fixtureKey().replace(/\.[^.]+$/, '.short'),
]) {
  test(`rejects forbidden key fixture ${String(key).slice(0, 12)}`, () => {
    assert.throws(
      () => buildLocalStorefrontEnvironment(options({ supabaseAnonKey: key })),
      (error) => {
        assert.match(error.message, /public local Supabase anon JWT/);
        if (key) assert.ok(!error.message.includes(key));
        return true;
      }
    );
  });
}

test('normal native entry requires Expo Router and never the phone QA entry', () => {
  const source = readFileSync(
    new URL('../../apps/mobile-storefront/index.js', import.meta.url),
    'utf8'
  );
  const required = [];
  runInNewContext(source.replace(/^import .*;$/gm, ''), {
    process: { env: buildLocalStorefrontEnvironment(options()).environment },
    global: { crypto: {} },
    __DEV__: true,
    require(name) {
      required.push(name);
      return {
        initializeErrorMonitoring: () => false,
        installLocalStorefrontRuntime: () => undefined,
      };
    },
  });
  assert.deepEqual(required, [
    './lib/install-local-storefront-runtime',
    './services/error-monitoring',
    'expo-router/entry',
  ]);
});

test('namespaces existing auth keys by full local origins', () => {
  const source = readFileSync(
    new URL(
      '../../apps/mobile-storefront/lib/auth/supabase-auth-storage-key.ts',
      import.meta.url
    ),
    'utf8'
  );
  const deriveKey = runInNewContext(
    `${stripTypeScriptTypes(source).replace('export ', '')}\ngetDefaultSupabaseAuthStorageKey`,
    { URL }
  );
  const plan = buildLocalStorefrontEnvironment(options());
  assert.equal(
    plan.authStorageKey,
    plan.storagePrefix + deriveKey(options().supabaseOrigin)
  );
  assert.notEqual(
    plan.authStorageKey,
    deriveKey('https://hosted-project.supabase.co')
  );
  const other = buildLocalStorefrontEnvironment(
    options({ supabaseOrigin: 'http://192.168.2.3:54322' })
  );
  assert.notEqual(plan.authStorageKey, other.authStorageKey);
  assert.match(plan.storagePrefix, /^[A-Za-z0-9._-]+$/);
});

test('builds a ready guarded normal launch requiring a full reload', () => {
  const plan = buildLocalStorefrontEnvironment(options());
  assert.equal(plan.entryPoint, 'expo-router/entry');
  assert.equal(plan.launchReady, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.requiresFullReload, true);
});

test('skips the direct dotenv loader in validated local mode', () => {
  const source = readFileSync(
    new URL('../../apps/mobile-storefront/app.config.ts', import.meta.url),
    'utf8'
  );
  const preamble = source.slice(
    source.indexOf('const localStorefrontConfig'),
    source.indexOf('const { createExpoPlugins }')
  );
  const environment = {
    ...buildLocalStorefrontEnvironment(options()).environment,
  };
  runInNewContext(preamble, {
    buildLocalStorefrontExpoConfig: () => ({}),
    process: { env: environment },
    __dirname: '/unused',
    path: { resolve: () => '/never-read' },
    require(name) {
      assert.equal(name, 'dotenv');
      return {
        config() {
          environment.UNEXPECTED_DOTENV_SECRET = 'fixture-only';
        },
      };
    },
  });
  assert.equal(environment.UNEXPECTED_DOTENV_SECRET, undefined);
});
