import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dispatchOnlyFailures,
  readJob,
  readJobIds,
  readStep,
  readStepNames,
  readWorkflowTriggers,
  releaseTriggerFailures,
  shipsStorefront,
} from './storefront-release-gate-workflows.mjs';

const GATED_RELEASE = `name: Release

on:
  # The gate keeps only owner tags and manual dispatch.
  push:
    tags:
      - 'v*-storefront-ios'
  workflow_dispatch:
    inputs:
      build_number:
        description: 'Build number'
        required: false
        type: choice
        options:
          - internal
          - production

permissions:
  contents: read
`;

const MAIN_PUSH_RELEASE = `on:
  push:
    branches:
      - main
    paths:
      - 'apps/mobile-storefront/**'
    tags:
      - 'v*-storefront-ios'
  workflow_dispatch:
`;

function triggerSummary(text) {
  const { events, error } = readWorkflowTriggers(text);
  if (error) return { error };
  return Object.fromEntries([...events].map(([event, keys]) => [event, Object.fromEntries(keys)]));
}

test('reads block-style triggers, list items and inline lists, ignoring nested input options', () => {
  assert.deepEqual(triggerSummary(GATED_RELEASE), {
    push: { tags: ['v*-storefront-ios'] },
    workflow_dispatch: { inputs: [] },
  });
  assert.deepEqual(triggerSummary(`on: # triggers\n  push:\n    branches: [main, "release"]\n    tags: v1\n`), {
    push: { branches: ['main', 'release'], tags: ['v1'] },
  });
  assert.deepEqual(triggerSummary(`"on":\n  workflow_dispatch: {}\njobs:\n  a:\n    on: ignored\n`), {
    workflow_dispatch: {},
  });
  assert.deepEqual(triggerSummary("on:\n  schedule:\n    - cron: '0 0 * * *'\n"), { schedule: {} });
});

test('refuses trigger shapes it cannot read instead of passing them', () => {
  const unreadable = {
    'no on block': 'name: x\njobs: {}\n',
    'inline event list': 'on: [push, workflow_dispatch]\n',
    'flow mapping event': 'on:\n  push: {branches: [main]}\n',
    'list item at the key indent': 'on:\n  push:\n    branches:\n    - main\n',
    'odd indentation': 'on:\n   push:\n',
    'duplicate event': 'on:\n  push:\n    tags: [a]\n  push:\n    branches: [main]\n',
    'second on block': 'on:\n  workflow_dispatch:\non:\n  push:\n',
  };
  for (const [label, text] of Object.entries(unreadable)) {
    assert.ok(readWorkflowTriggers(text).error, label);
  }
});

test('a gated release workflow passes and a main push trigger fails', () => {
  assert.deepEqual(releaseTriggerFailures('ios', GATED_RELEASE, ['v*-storefront-ios']), []);
  const failures = releaseTriggerFailures('ios', MAIN_PUSH_RELEASE, ['v*-storefront-ios']);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ios push trigger must list only tags \(found: branches, paths, tags\)/);
});

test('release workflows must keep the owner tag and manual dispatch, and add no other trigger', () => {
  const noTags = 'on:\n  push:\n    branches-ignore: [main]\n  workflow_dispatch:\n';
  assert.match(releaseTriggerFailures('ios', noTags, ['v*-storefront-ios']).join('\n'), /must keep its owner release tag/);
  const wrongTag = GATED_RELEASE.replace("'v*-storefront-ios'", "'v*'");
  assert.match(releaseTriggerFailures('ios', wrongTag, ['v*-storefront-ios']).join('\n'), /must keep its owner release tag v\*-storefront-ios/);
  const noDispatch = "on:\n  push:\n    tags: ['v*-storefront-ios']\n";
  assert.match(releaseTriggerFailures('ios', noDispatch, ['v*-storefront-ios']).join('\n'), /found: push\)/);
  const scheduled = GATED_RELEASE.replace('  workflow_dispatch:', "  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch:");
  assert.match(releaseTriggerFailures('ios', scheduled, ['v*-storefront-ios']).join('\n'), /found: push, schedule, workflow_dispatch\)/);
  assert.match(releaseTriggerFailures('ios', 'on: push\n', ['v*-storefront-ios'])[0], /^ios must declare on: as a block mapping$/);
});

test('dispatch-only workflows accept nothing but workflow_dispatch', () => {
  assert.deepEqual(dispatchOnlyFailures('ota', 'on:\n  workflow_dispatch:\n    inputs:\n      a:\n        type: string\n'), []);
  assert.match(dispatchOnlyFailures('ota', 'on:\n  workflow_dispatch:\n  push:\n    branches: [main]\n')[0], /ota must trigger only on workflow_dispatch \(found: push, workflow_dispatch\)/);
  assert.match(dispatchOnlyFailures('ota', 'on:\n  workflow_call:\n')[0], /found: workflow_call/);
});

test('detects workflows that build or ship the storefront app', () => {
  assert.equal(shipsStorefront('env:\n  WORKING_DIR: apps/mobile-storefront\n    run: bundle exec fastlane ios release\n'), true);
  assert.equal(shipsStorefront('working-directory: apps/mobile-storefront\nrun: pnpm exec expo export --platform ios\n'), true);
  assert.equal(shipsStorefront('uses: r0adkll/upload-google-play@x\n  packageName: com.ogabassey.store\n'), true);
  assert.equal(shipsStorefront('run: npx eas update --branch production\nworking-directory: apps/mobile-storefront\n'), true);
  assert.equal(shipsStorefront('run: pnpm --filter @baci/mobile-storefront exec eas update --branch production --auto\n'), true);
  assert.equal(shipsStorefront('working-directory: apps/mobile-storefront\nrun: npx eas-cli@latest update --channel production\n'), true);
  assert.equal(shipsStorefront('working-directory: apps/mobile-storefront\nrun: npx  eas  build --platform ios\n'), true);
  assert.equal(shipsStorefront('run: pnpm --filter @baci/mobile-storefront exec eas workflow:run release.yml\n'), true);
  assert.equal(shipsStorefront('uses: apple-actions/upload-testflight-build@v3\n  app-path: apps/mobile-storefront/out.ipa\n'), true);
  assert.equal(shipsStorefront('run: xcrun altool --upload-app -f apps/mobile-storefront/out.ipa\n'), true);
  assert.equal(shipsStorefront('WORKING_DIR: apps/mobile-admin\nrun: bundle exec fastlane ios release\n'), false);
  assert.equal(shipsStorefront('run: pnpm --filter @baci/mobile-storefront exec jest\n'), false);
  assert.equal(shipsStorefront('run: pnpm --filter @baci/mobile-storefront exec easy-test\n'), false);
});

const STEPS = `jobs:
  gate:
    steps:
      - name: Guard the source
        run: echo gate
  export:
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Check out main history
        uses: actions/checkout@v7
      - name: Guard the source
        env:
          SOURCE_SHA: \${{ inputs.source_sha }}
        run: |
          set -euo pipefail

          echo "guarded"
      - name: Validate
        run: echo validate

  # Publishing runs after the export.
  publish:
    needs: export
    steps:
      - name: Publish
        run: echo publish
`;

test('reads one job block, so a step in another job never counts', () => {
  const exportJob = readJob(STEPS, 'export');
  assert.match(exportJob, /^  export:\n    if: github\.ref == 'refs\/heads\/main'/);
  assert.deepEqual(readStepNames(exportJob), ['Check out main history', 'Guard the source', 'Validate']);
  assert.deepEqual(readStepNames(readJob(STEPS, 'gate')), ['Guard the source']);
  assert.deepEqual(readStepNames(readJob(STEPS, 'publish')), ['Publish']);
  assert.equal(readJob(STEPS, 'missing'), undefined);
  assert.equal(readJob('name: x\non:\n  export:\n', 'export'), undefined, 'only keys under the top-level jobs: block are jobs');
});

test('reads step names in order and a step block scalar run script', () => {
  const exportJob = readJob(STEPS, 'export');
  assert.deepEqual(readStepNames(exportJob), ['Check out main history', 'Guard the source', 'Validate']);
  const step = readStep(exportJob, 'Guard the source');
  assert.equal(step.run, 'set -euo pipefail\n\necho "guarded"');
  assert.match(step.text, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.doesNotMatch(step.text, /validate/);
  assert.equal(readStep(exportJob, 'Validate').run, undefined, 'a plain scalar run is not a block script');
  assert.equal(readStep(exportJob, 'Missing'), undefined);
});

test('a fastlane path segment is not the fastlane tool', () => {
  const app = 'apps/mobile-storefront\n';
  assert.equal(shipsStorefront(`${app}path.join(projectRoot, 'fastlane', 'Fastfile')`), false);
  assert.equal(shipsStorefront(`${app}bundle exec fastlane ios release`), true);
  assert.equal(shipsStorefront(`${app}fastlane android deploy`), true);
});

test('native Gradle release builds count as shipping the storefront', () => {
  const app = 'working-directory: apps/mobile-storefront/android\n';
  for (const command of ['./gradlew bundleRelease', 'gradle assembleRelease --no-daemon', './gradlew app:bundleRelease -x lint']) {
    assert.equal(shipsStorefront(`${app}run: ${command}`), true, command);
  }
  assert.equal(shipsStorefront(`${app}run: ./gradlew testDebugUnitTest`), false);
});

test('quoted or unreadable job entries are counted so a second job cannot hide', () => {
  const text = "jobs:\n  ship:\n    steps: []\n  'publish':\n    steps: []\n  \"third\":\n    steps: []\n  ? odd\n  : steps: []\n";
  assert.deepEqual(readJobIds(text), ['ship', 'publish', 'third', '(unreadable job entry)', '(unreadable job entry)']);
});

test('steps whose keys are quoted still count as steps', () => {
  const text = '    steps:\n      - "name": Guard\n        "run": echo\n      - \'run\': echo hi\n      - "uses": actions/checkout@v4\n';
  assert.deepEqual(readStepNames(text), ['Guard', '(unnamed step)', '(unnamed step)']);
});
