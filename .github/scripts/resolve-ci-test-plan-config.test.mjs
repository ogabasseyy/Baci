import assert from 'node:assert/strict';
import test from 'node:test';
import { ciTestPlanConfig } from './resolve-ci-test-plan-config.mjs';
import './ci-lint-gate-contract.test.mjs';
import './ci-typecheck-runner-contract.test.mjs';
import './ci-web-shard-runner-contract.test.mjs';
import './ci-non-web-runner-contract.test.mjs';
import './cleanup-shipping-ci-containers.test.mjs';
import './cleanup-builder-ci-containers.test.mjs';
import './ci-builder-container-labels.test.mjs';
import '../../supabase/tests/shipping-ci-container-labels.test.mjs';
import './ci-build-runner-contract.test.mjs';
import './dependency-review-availability.test.mjs';
import './codeql-private-availability.test.mjs';
import './jules-sunset-contract.test.mjs';
import './jules-findings-gate.test.mjs';
import './pnpm-install-with-retry.test.mjs';
import './tools-worker-typecheck-contract.test.mjs';
import './web-build-timeout-contract.test.mjs';
import './web-test-checkout-contract.test.mjs';
import './shipping-recovery-ci-contract.test.mjs';

test('treats turbo build env additions as safe config smoke changes', () => {
  assert.equal(
    ciTestPlanConfig.isSafeConfigSmokeChange('turbo.json', {
      'turbo.json': {
        before: {
          tasks: {
            build: {
              env: ['NEXT_PUBLIC_SUPABASE_URL'],
              outputs: ['dist/**'],
            },
          },
        },
        after: {
          tasks: {
            build: {
              env: ['NEXT_PUBLIC_SUPABASE_URL', 'GIGL_EMAIL'],
              outputs: ['dist/**'],
            },
          },
        },
      },
    }),
    true
  );
});

test('rejects turbo build env removals as safe config smoke changes', () => {
  assert.equal(
    ciTestPlanConfig.isSafeConfigSmokeChange('turbo.json', {
      'turbo.json': {
        before: {
          tasks: {
            build: {
              env: ['NEXT_PUBLIC_SUPABASE_URL', 'GIGL_EMAIL'],
            },
          },
        },
        after: {
          tasks: {
            build: {
              env: ['NEXT_PUBLIC_SUPABASE_URL'],
            },
          },
        },
      },
    }),
    false
  );
});
