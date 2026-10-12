import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveHostedStagingPushConfig } from './resolve-config.mjs';

const require = createRequire(import.meta.url);
const {
  prepareHostedStagingPushBuild,
} = require('../../../apps/mobile-storefront/config/hosted-staging-push-build.js');
const PROFILE = 'hosted-staging-push';
const PINS_URL = new URL(
  '../../../apps/mobile-storefront/config/hosted-storefront-pins.json',
  import.meta.url
);
const BASE_FIELDS = [
  'mode',
  'apiOrigin',
  'supabaseOrigin',
  'expectedAuthIssuer',
  'merchantId',
  'publicKeySha256',
];
const PROFILE_FIELDS = [
  'node',
  'developmentClient',
  'distribution',
  'environment',
  'ios',
  'android',
  'env',
];
const ENVIRONMENT_VALUES = {
  NODE_ENV: 'development',
  EXPO_PUBLIC_ENV: 'development',
  BACI_REVIEWED_HOSTED_PUSH_BUILD: '1',
  EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
  EXPO_PUBLIC_LOCAL_STOREFRONT: '0',
  EXPO_PUBLIC_PHONE_QA: '0',
  EXPO_PUBLIC_API_URL: 'https://staging.ogabassey.com',
  EXPO_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
  EXPO_PUBLIC_MERCHANT_ID: '10000000-0000-4000-8000-000000000001',
  EXPO_PUBLIC_POSTHOG_API_KEY: '',
  EXPO_PUBLIC_POSTHOG_HOST: 'https://staging.ogabassey.com',
  EXPO_PUBLIC_SENTRY_DSN: '',
};
const ENVIRONMENT_FIELDS = [
  ...Object.keys(ENVIRONMENT_VALUES),
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
];
const GUARD_ERRORS = new Set([
  'Hosted push build requires the reviewed EAS profile',
  'Hosted push build requires unchanged reviewed staging pins',
  'Hosted push build requires separate reviewed native pins',
  'Hosted push build environment does not match reviewed pins',
]);

function exactFields(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function report(blockers, manifestSha256 = null) {
  return {
    prepared: blockers.length === 0,
    buildAuthorized: false,
    deviceAcceptanceVerified: false,
    configResolutionVerified: manifestSha256 !== null,
    manifestSha256,
    blockers,
    remainingGates: [
      'eas-authenticated-separate-project-evidence',
      ...(manifestSha256 === null ? ['resolved-staging-config-required'] : []),
      'isolated-native-generation-and-push-entitlements',
      'physical-device-acceptance',
    ],
  };
}

export function evaluateHostedStagingPushBuildPreparation(
  pins,
  fragment,
  baseline
) {
  const blockers = [];
  let manifestSha256 = null;
  if (
    !BASE_FIELDS.every(
      (field) =>
        typeof baseline?.[field] === 'string' &&
        pins?.[field] === baseline[field]
    )
  )
    blockers.push('reviewed-baseline-changed');
  const profile = fragment?.build?.[PROFILE];
  if (
    !exactFields(fragment, ['build']) ||
    !exactFields(fragment.build, [PROFILE]) ||
    !exactFields(profile, PROFILE_FIELDS) ||
    profile.node !== '24.11.1' ||
    profile.developmentClient !== true ||
    profile.distribution !== 'internal' ||
    profile.environment !== 'development' ||
    !exactFields(profile.ios, ['simulator']) ||
    profile.ios.simulator !== false ||
    !exactFields(profile.android, ['buildType']) ||
    profile.android.buildType !== 'apk' ||
    !exactFields(profile.env, ENVIRONMENT_FIELDS) ||
    !Object.entries(ENVIRONMENT_VALUES).every(
      ([field, value]) => profile.env[field] === value
    )
  ) {
    blockers.push('isolated-profile-required');
  } else {
    try {
      prepareHostedStagingPushBuild(
        {
          ...profile.env,
          EAS_BUILD: 'true',
          EAS_BUILD_PROFILE: PROFILE,
          CI: '1',
        },
        pins
      );
    } catch (error) {
      blockers.push(
        GUARD_ERRORS.has(error.message) ? error.message : 'build-guard-refused'
      );
    }
  }
  if (blockers.length === 0) {
    try {
      const manifest = resolveHostedStagingPushConfig(
        {
          ...profile.env,
          NODE_ENV: 'production',
          EAS_BUILD: 'true',
          EAS_BUILD_PROFILE: PROFILE,
          CI: '1',
        },
        pins
      );
      if (
        manifest.extra?.eas?.projectId !== pins.nativeStagingPush.projectId ||
        manifest.ios?.bundleIdentifier !==
          pins.nativeStagingPush.iosBundleIdentifier ||
        manifest.android?.package !== pins.nativeStagingPush.androidPackage ||
        manifest.updates?.enabled !== false ||
        manifest.extra?.posthogApiKey !== '' ||
        manifest.extra?.facebookAppId !== '' ||
        !manifest.plugins?.includes('expo-dev-client') ||
        !manifest.plugins?.some(
          (plugin) =>
            Array.isArray(plugin) && plugin[0] === 'expo-notifications'
        )
      )
        throw new Error('Manifest mismatch');
      manifestSha256 = createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');
    } catch {
      blockers.push('root-app-config-refused');
    }
  }
  return report(blockers, manifestSha256);
}

function readJson(path) {
  const source = readFileSync(path, 'utf8');
  if (source.length > 262144) throw new Error('Input exceeds limit');
  return JSON.parse(source);
}

function runCli(args) {
  try {
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
      const name = args[index];
      const value = args[index + 1];
      if (
        !['--pins', '--profile'].includes(name) ||
        !value ||
        value.startsWith('--') ||
        options.has(name)
      )
        throw new Error('Invalid options');
      options.set(name, value);
    }
    const baseline = readJson(PINS_URL);
    return evaluateHostedStagingPushBuildPreparation(
      options.has('--pins') ? readJson(options.get('--pins')) : baseline,
      readJson(
        options.get('--profile') ??
          new URL('./eas-profile.template.json', import.meta.url)
      ),
      baseline
    );
  } catch {
    return report(['input-invalid']);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.prepared ? 0 : 1;
}
