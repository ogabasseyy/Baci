import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getDirectWorkerPreflightProblems } from './preflight-direct-web-workers.mjs';

// Split from preflight-direct-web-workers.test.mjs: worker-token
// algorithm/role coverage lives here so both suites stay under the
// 300-line limit.

const commonEnv = {
  BACI_REPO_DIR: fileURLToPath(new URL('../..', import.meta.url)),
  BACI_WEB_BASE_URL: 'https://usebaci.com',
  GIGL_BASE_URL: 'https://gigl.example.com',
  GIGL_EMAIL: 'worker@example.com',
  GIGL_PASSWORD: 'provider-password',
  GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker'),
  INTERNAL_API_SECRET: 'test-internal-secret',
  IMEI_IDENTIFIER_ENCRYPTION_KEY: 'encryption-key',
  JUMIA_AUTHORIZATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://projectref.supabase.co',
  PETROCK_API_TOKEN: 'petrock-token',
  PETROCK_ENABLED: 'true',
  PETROCK_ENABLED_TIERS: 'blacklist',
  PETROCK_REMEDIATION_ENABLED: 'true',
  QUIZ_PHASE: '1a',
  QUIZ_PRODUCTION_APPROVED: 'false',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JUMIA_CREDENTIAL_KEY: 'jumia-credential-key',
  ZEPTOMAIL_TOKEN: 'zeptomail-token',
};

function token(role, alg = 'ES256', exp = 4_102_444_800) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString(
    'base64url'
  );
  const payload = Buffer.from(JSON.stringify({ exp, role })).toString(
    'base64url'
  );
  return `${header}.${payload}.signature`;
}

describe('direct worker preflight gigl token', () => {
  it('rejects a token for an elevated database role', () => {
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      }),
      ['GIGL_TRACKING_WORKER_TOKEN must be a current restricted worker token']
    );
  });

  it('rejects a usable non-worker token when GIGL is disabled', () => {
    // A valid service_role JWT is a live credential, not a missing
    // one: the disabled preflight must not pass it silently.
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_ENABLED: 'off',
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      }),
      [
        'GIGL_TRACKING_WORKER_TOKEN must not be a usable non-worker token while GIGL is disabled',
      ]
    );
  });

  it('accepts an expired non-worker token when GIGL is disabled', () => {
    // Unusable credentials stay vacuous: nothing to abuse.
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_ENABLED: 'off',
        GIGL_TRACKING_WORKER_TOKEN: token(
          'service_role',
          'ES256',
          Math.floor(Date.now() / 1000) - 60
        ),
      }),
      []
    );
  });

  it('accepts RS256 worker tokens from Supabase RSA signing keys', () => {
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker', 'RS256'),
      }),
      []
    );
  });

  it('rejects an RS256 usable non-worker token when GIGL is disabled', () => {
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_ENABLED: 'off',
        GIGL_TRACKING_WORKER_TOKEN: token('service_role', 'RS256'),
      }),
      [
        'GIGL_TRACKING_WORKER_TOKEN must not be a usable non-worker token while GIGL is disabled',
      ]
    );
  });

  it('rejects a worker token inside the 14-day rotation window', () => {
    // 13 days out: live, but the rotation runbook requires rotation
    // when expiry is within 14 days, and the cutover checklist needs
    // >=14 days before the Vercel schedule is removed.
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_TRACKING_WORKER_TOKEN: token(
          'gigl_tracking_worker',
          'ES256',
          Math.floor(Date.now() / 1000) + 13 * 24 * 60 * 60
        ),
      }),
      ['GIGL_TRACKING_WORKER_TOKEN must be a current restricted worker token']
    );
  });

  it('accepts a worker token beyond the 14-day rotation window', () => {
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_TRACKING_WORKER_TOKEN: token(
          'gigl_tracking_worker',
          'ES256',
          Math.floor(Date.now() / 1000) + 15 * 24 * 60 * 60
        ),
      }),
      []
    );
  });
});
