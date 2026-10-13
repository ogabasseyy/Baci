import assert from 'node:assert/strict';
import test from 'node:test';
import { ciTestPlanConfig } from './resolve-ci-test-plan-config.mjs';
import './tools-worker-typecheck-contract.test.mjs';
import './web-build-timeout-contract.test.mjs';
import './web-test-checkout-contract.test.mjs';

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
