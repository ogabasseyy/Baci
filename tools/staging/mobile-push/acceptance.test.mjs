import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateHostedStagingPushAcceptance } from './acceptance.mjs';
import { evaluateHostedStagingPushBuildPreparation } from './preflight.mjs';

const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const key = 'synthetic-acceptance-test-key';
const baseline = {
  ...read('../../../apps/mobile-storefront/config/hosted-storefront-pins.json'),
  publicKeySha256: createHash('sha256').update(key).digest('hex'),
};
const projectId = '22222222-2222-4222-8222-222222222222';
const buildId = '33333333-3333-4333-8333-333333333333';
const pins = {
  ...baseline,
  nativeStagingPush: {
    projectId,
    iosBundleIdentifier: 'com.ogabassey.staging',
    androidPackage: 'com.ogabassey.staging',
    allowedOrigins: [
      baseline.apiOrigin,
      baseline.supabaseOrigin,
      'https://exp.host',
    ],
  },
};
const profile = read('./eas-profile.template.json');
profile.build['hosted-staging-push'].env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
profile.build['hosted-staging-push'].env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  key;
const now = Date.parse('2026-10-02T12:00:00Z');
const digest = 'a'.repeat(64);

function fixture() {
  const evidence = read('./acceptance.template.json');
  evidence.observedAt = new Date(now).toISOString();
  evidence.project = {
    authenticated: true,
    ownerApproved: true,
    projectId,
    inventorySha256: digest,
    signingApproved: true,
  };
  evidence.build = {
    platform: 'ios',
    buildId,
    projectId,
    manifestSha256: evaluateHostedStagingPushBuildPreparation(
      pins,
      profile,
      baseline
    ).manifestSha256,
    artifactSha256: digest,
    nativeGeneratedFromStaging: true,
    pushCredentialsMatchStaging: true,
  };
  evidence.device = {
    physical: true,
    platform: 'ios',
    applicationId: pins.nativeStagingPush.iosBundleIdentifier,
    installedBuildId: buildId,
    permissionGranted: true,
    tokenRegisteredToStaging: true,
    registrationEvidenceSha256: digest,
  };
  evidence.delivery = {
    foreground: true,
    background: true,
    coldStartTap: true,
    matchingGoalOpened: true,
    scopedWalletQueryRefreshed: true,
    receiptEvidenceSha256: digest,
  };
  evidence.interest = {
    providerPaidReceiptVerified: true,
    netAmountKobo: 733,
    paidNetCopyVerified: true,
    earningsAndGoalRefreshed: true,
    duplicateCreditAbsent: true,
    receiptEvidenceSha256: digest,
  };
  evidence.sample = {
    nonProviderLabelVisible: true,
    persistedBalancesUnchanged: true,
  };
  return evidence;
}

const evaluate = (evidence, overrides = {}) =>
  evaluateHostedStagingPushAcceptance({
    pins,
    profile,
    baseline,
    evidence,
    now,
    ...overrides,
  });

test('synthetic complete evidence passes structure only and never claims device, provider or build authorization', () => {
  const result = evaluate(fixture());
  assert.equal(result.evidenceAccepted, true);
  assert.equal(result.deviceAcceptanceVerified, false);
  assert.equal(result.providerPayoutVerified, false);
  assert.equal(result.buildAuthorized, false);
  assert.equal(result.parentEvidenceReviewRequired, true);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(result).includes(projectId), false);
});

test('default disconnected evidence refuses every unavoidable acceptance gate', () => {
  const result = evaluate(read('./acceptance.template.json'));
  assert.equal(result.evidenceAccepted, false);
  assert.ok(
    result.blockers.includes('approved-authenticated-staging-project-required')
  );
  assert.ok(
    result.blockers.includes('physical-staging-device-registration-required')
  );
  assert.ok(
    result.blockers.includes('genuine-paid-interest-evidence-required')
  );
});

test('regression: preview and inbox evidence cannot substitute for provider payment or push delivery', () => {
  const evidence = fixture();
  evidence.interest.providerPaidReceiptVerified = false;
  evidence.delivery.background = false;
  const result = evaluate(evidence);
  assert.ok(
    result.blockers.includes('genuine-paid-interest-evidence-required')
  );
  assert.ok(
    result.blockers.includes('push-receipt-navigation-refresh-required')
  );
});

test('rejects production project, mismatched build and incorrect installed native identity', () => {
  for (const mutate of [
    (data) => {
      data.project.projectId = 'c6c1897b-cac8-49b0-85f9-3d277aecc379';
    },
    (data) => {
      data.build.manifestSha256 = 'b'.repeat(64);
    },
    (data) => {
      data.build.nativeGeneratedFromStaging = false;
    },
    (data) => {
      data.build.pushCredentialsMatchStaging = false;
    },
    (data) => {
      data.device.installedBuildId = projectId;
    },
    (data) => {
      data.device.applicationId = 'com.ogabassey.app';
    },
    (data) => {
      data.device.physical = false;
    },
    (data) => {
      data.device.permissionGranted = false;
    },
    (data) => {
      data.device.tokenRegisteredToStaging = false;
    },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    assert.equal(evaluate(evidence).evidenceAccepted, false);
  }
});

test('requires scoped refresh, paid net copy, duplicate safety and labelled nonprovider sample', () => {
  for (const [section, field] of [
    ['delivery', 'coldStartTap'],
    ['delivery', 'matchingGoalOpened'],
    ['delivery', 'scopedWalletQueryRefreshed'],
    ['interest', 'paidNetCopyVerified'],
    ['interest', 'earningsAndGoalRefreshed'],
    ['interest', 'duplicateCreditAbsent'],
    ['sample', 'nonProviderLabelVisible'],
    ['sample', 'persistedBalancesUnchanged'],
    ['project', 'signingApproved'],
    ['project', 'ownerApproved'],
  ]) {
    const evidence = fixture();
    evidence[section][field] = false;
    assert.equal(evaluate(evidence).evidenceAccepted, false);
  }
});

test('refuses expired, stale and future observations at the fixed staging deadline', () => {
  const evidence = fixture();
  assert.equal(
    evaluate(evidence, { now: Date.parse('2026-10-06T15:59:10Z') })
      .evidenceAccepted,
    false
  );
  evidence.observedAt = '2026-09-30T12:00:00Z';
  assert.ok(evaluate(evidence).blockers.includes('fresh-observation-required'));
  evidence.observedAt = '2026-10-03T12:00:00Z';
  assert.ok(evaluate(evidence).blockers.includes('fresh-observation-required'));
});

test('rejects unexpected tokens and any financial activation or changed principal', () => {
  for (const mutate of [
    (data) => {
      data.device.token = 'never-output-secret';
    },
    (data) => {
      data.protectedState.principalKobo = 10001;
    },
    (data) => {
      data.protectedState.approvedPrefundingKobo = 10001;
    },
    (data) => {
      data.protectedState.financialReplayEnabled = true;
    },
    (data) => {
      data.protectedState.backgroundEnabled = true;
    },
    (data) => {
      data.protectedState.snapshotEnabled = true;
    },
    (data) => {
      data.protectedState.checkoutEnabled = true;
    },
    (data) => {
      data.protectedState.checkoutPostStatus = 200;
    },
    (data) => {
      data.protectedState.checkoutPatchStatus = 200;
    },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    const result = evaluate(evidence);
    assert.ok(result.blockers.includes('acceptance-evidence-invalid'));
    assert.equal(JSON.stringify(result).includes('never-output-secret'), false);
  }
});

test('acceptance CLI refuses disabled templates and invalid arguments without echoing inputs', () => {
  for (const args of [
    [],
    ['--token', 'never-output-secret'],
    ['--evidence', '/missing/never-output-secret'],
    ['--pins'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./acceptance.mjs', import.meta.url)), ...args],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).evidenceAccepted, false);
    assert.equal(result.stdout.includes('never-output-secret'), false);
    assert.equal(result.stderr, '');
  }
});

test('regression: installed iOS evidence rejects an Android or missing build platform', () => {
  for (const platform of ['android', null]) {
    const evidence = fixture();
    evidence.build.platform = platform;
    assert.ok(
      evaluate(evidence).blockers.includes(
        'matching-signed-staging-build-required'
      )
    );
  }
  const evidence = fixture();
  delete evidence.build.platform;
  assert.ok(
    evaluate(evidence).blockers.includes('acceptance-evidence-invalid')
  );
});

test('accepts matching Android build and device metadata as offline evidence only', () => {
  const evidence = fixture();
  evidence.build.platform = 'android';
  evidence.device.platform = 'android';
  evidence.device.applicationId = pins.nativeStagingPush.androidPackage;
  assert.equal(evaluate(evidence).evidenceAccepted, true);
  assert.equal(evaluate(evidence).deviceAcceptanceVerified, false);
});
