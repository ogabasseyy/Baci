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
import './ci-hosted-free-runner-contract.test.mjs';
import './ci-hosted-postgresql-contract.test.mjs';
import './install-postgresql-hosted.test.mjs';
import './dependency-review-availability.test.mjs';
import './codeql-private-availability.test.mjs';
import './jules-sunset-contract.test.mjs';
import './jules-findings-gate.test.mjs';
import './diff-guardian-ci-filter.test.mjs';
import './diff-guardian-inputs.test.mjs';
import './diff-guardian-muse-contract.test.mjs';
import './diff-guardian-voters.test.mjs';
import './gemini-code-review-workflow.test.mjs';
import './gemini-review/api.test.mjs';
import './gemini-review/call.test.mjs';
import './gemini-review/collect.test.mjs';
import './gemini-review/decide.test.mjs';
import './gemini-review/fingerprint.test.mjs';
import './gemini-review/post.test.mjs';
import './gemini-review/review.test.mjs';
import './gemini-review/sanitize.test.mjs';
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
