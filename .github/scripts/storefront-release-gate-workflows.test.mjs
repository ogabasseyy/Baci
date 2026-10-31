import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dispatchesWorkflow,
  dispatchOnlyFailures,
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
  assert.equal(shipsStorefront('WORKING_DIR: apps/mobile-admin\nrun: bundle exec fastlane ios release\n'), false);
  assert.equal(shipsStorefront('run: pnpm --filter @baci/mobile-storefront exec jest\n'), false);
});

test('detects another workflow dispatching a gated workflow', () => {
  assert.equal(dispatchesWorkflow('run: gh workflow run ios-storefront-release.yml --ref main', 'ios-storefront-release.yml'), true);
  assert.equal(dispatchesWorkflow('run: gh workflow run --ref main ios-storefront-release.yml', 'ios-storefront-release.yml'), true);
  assert.equal(dispatchesWorkflow('run: gh  workflow  run "ios-storefront-release.yml" -f build_number=9', 'ios-storefront-release.yml'), true);
  assert.equal(dispatchesWorkflow("  workflow_id: 'ios-storefront-release.yml',", 'ios-storefront-release.yml'), true);
  assert.equal(dispatchesWorkflow('url: /repos/o/r/actions/workflows/ios-storefront-release.yml/dispatches', 'ios-storefront-release.yml'), true);
  assert.equal(dispatchesWorkflow('run: gh workflow run security.yml\nnotes: ios-storefront-release.yml', 'ios-storefront-release.yml'), false);
  assert.equal(dispatchesWorkflow('run: gh workflow run security.yml', 'ios-storefront-release.yml'), false);
});

const STEPS = `jobs:
  export:
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
`;

test('reads step names in order and a step block scalar run script', () => {
  assert.deepEqual(readStepNames(STEPS), ['Check out main history', 'Guard the source', 'Validate']);
  const step = readStep(STEPS, 'Guard the source');
  assert.equal(step.run, 'set -euo pipefail\n\necho "guarded"');
  assert.match(step.text, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.doesNotMatch(step.text, /validate/);
  assert.equal(readStep(STEPS, 'Validate').run, undefined, 'a plain scalar run is not a block script');
  assert.equal(readStep(STEPS, 'Missing'), undefined);
});
