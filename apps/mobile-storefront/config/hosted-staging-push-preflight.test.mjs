import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHostedStagingPushPreflight } from './hosted-staging-push-preflight.mjs';

const apiOrigin = 'https://staging.ogabassey.com';
const supabaseOrigin = 'https://staging-auth.ogabassey.com';
const projectId = '22222222-2222-4222-8222-222222222222';
const identity = {
  projectId,
  iosBundleIdentifier: 'com.ogabassey.staging',
  androidPackage: 'com.ogabassey.staging',
  allowedOrigins: [apiOrigin, supabaseOrigin, 'https://exp.host'],
};

function createInput(overrides = {}) {
  return {
    pins: { apiOrigin, supabaseOrigin, nativeStagingPush: identity },
    installedApplicationId: identity.iosBundleIdentifier,
    installedPlatform: 'ios',
    easConfig: {
      build: {
        'hosted-staging-push': {
          distribution: 'internal',
          env: {
            EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
            EXPO_PUBLIC_API_URL: apiOrigin,
            EXPO_PUBLIC_SUPABASE_URL: supabaseOrigin,
            EXPO_PUBLIC_POSTHOG_API_KEY: '',
          },
        },
      },
    },
    manifest: {
      ios: { bundleIdentifier: identity.iosBundleIdentifier },
      android: { package: identity.androidPackage },
      extra: {
        eas: { projectId },
        hostedStagingPush: identity,
        hostedStorefront: true,
        apiUrl: apiOrigin,
        supabaseUrl: supabaseOrigin,
        posthogApiKey: '',
        facebookAppId: '',
        facebookClientToken: '',
        tiktokBusiness: { isConfigured: false },
      },
      updates: { enabled: false },
    },
    ...overrides,
  };
}

test('accepts only a resolved staging manifest and internal isolated EAS profile', () => {
  assert.deepEqual(evaluateHostedStagingPushPreflight(createInput()), {
    ready: true,
    blockers: [],
  });
});

test('blocks when no approved native staging identity or profile exists', () => {
  const input = createInput({
    pins: { apiOrigin, supabaseOrigin },
    easConfig: { build: {} },
  });
  const result = evaluateHostedStagingPushPreflight(input);
  assert.equal(result.ready, false);
  assert.ok(
    result.blockers.includes('No approved native staging identity is pinned')
  );
  assert.ok(
    result.blockers.includes('No hosted-staging-push EAS profile is configured')
  );
});

test('rejects production identity fallback and enabled telemetry', () => {
  const productionInput = createInput({
    pins: {
      apiOrigin,
      supabaseOrigin,
      nativeStagingPush: {
        ...identity,
        projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379',
      },
    },
  });
  assert.ok(
    evaluateHostedStagingPushPreflight(productionInput).blockers.includes(
      'The native staging project points to production'
    )
  );

  const analyticsInput = createInput();
  analyticsInput.easConfig.build[
    'hosted-staging-push'
  ].env.EXPO_PUBLIC_POSTHOG_API_KEY = 'enabled';
  assert.ok(
    evaluateHostedStagingPushPreflight(analyticsInput).blockers.includes(
      'The EAS profile is not isolated to staging with analytics disabled'
    )
  );
});

test('checks endpoint pins, resolved manifest, and installed application identity', () => {
  const endpointInput = createInput();
  endpointInput.manifest.extra.apiUrl = 'https://production.example';
  assert.ok(
    evaluateHostedStagingPushPreflight(endpointInput).blockers.includes(
      'The resolved Expo manifest does not match staging pins'
    )
  );

  const installedInput = createInput({
    installedApplicationId: 'com.ogabassey.other',
    installedPlatform: 'ios',
  });
  assert.ok(
    evaluateHostedStagingPushPreflight(installedInput).blockers.includes(
      'The installed application identity does not match staging pins'
    )
  );
});

test('requires the installed application id to be checked for a specific platform', () => {
  const result = evaluateHostedStagingPushPreflight(
    createInput({
      installedApplicationId: identity.iosBundleIdentifier,
      installedPlatform: undefined,
    })
  );
  assert.deepEqual(result, {
    ready: false,
    blockers: ['Invalid preflight input'],
  });
});

test('regression: a valid manifest cannot report ready without an installed application identity', () => {
  const result = evaluateHostedStagingPushPreflight(
    createInput({
      installedApplicationId: undefined,
      installedPlatform: undefined,
    })
  );
  assert.equal(result.ready, false);
  assert.ok(
    result.blockers.includes('The installed application identity is required')
  );
});

test('never returns manifest values or keys in validation errors', () => {
  const input = createInput();
  input.manifest.extra.supabasePublishableKey = 'private-fixture-value';
  const result = evaluateHostedStagingPushPreflight(input);
  assert.equal(result.ready, true);
  assert.equal(JSON.stringify(result).includes('private-fixture-value'), false);
});
