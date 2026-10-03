import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getDirectWorkerPreflightProblems } from './preflight-direct-web-workers.mjs';

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

describe('direct worker environment preflight', () => {
  it('requires the request-context cache expiry credential', () => {
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        INTERNAL_API_SECRET: '',
      }),
      ['INTERNAL_API_SECRET is required']
    );
  });
  it('accepts an explicitly configured pre-launch environment', () => {
    assert.deepEqual(getDirectWorkerPreflightProblems(commonEnv), []);
  });

  it('reports only missing variable names', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      PETROCK_API_TOKEN: '',
      QUIZ_PRODUCTION_APPROVED: '',
    });

    assert.deepEqual(problems, [
      'PETROCK_API_TOKEN is required',
      'QUIZ_PRODUCTION_APPROVED is required',
    ]);
    assert.doesNotMatch(problems.join(' '), /petrock-token|service-role-key/);
  });

  it('requires an explicit full-checkout path for direct TypeScript jobs', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      BACI_REPO_DIR: '',
    });

    assert.deepEqual(problems, ['BACI_REPO_DIR is required']);
  });

  it('requires the notification credential used by Petrock reconciliation', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      ZEPTOMAIL_TOKEN: '',
    });

    assert.deepEqual(problems, ['ZEPTOMAIL_TOKEN is required']);
  });

  it('requires the direct GIGL provider environment without requiring optional Expo credentials', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      EXPO_ACCESS_TOKEN: '',
      GIGL_BASE_URL: '',
    });

    assert.deepEqual(problems, ['GIGL_BASE_URL is required']);
  });

  for (const disabledValue of ['0', 'false', 'off', ' OFF ']) {
    it(`does not require provider credentials when GIGL is disabled with ${disabledValue}`, () => {
      const problems = getDirectWorkerPreflightProblems({
        ...commonEnv,
        GIGL_BASE_URL: '',
        GIGL_EMAIL: '',
        GIGL_ENABLED: disabledValue,
        GIGL_PASSWORD: '',
      });

      assert.deepEqual(problems, []);
    });
  }
  it('requires the shared Jumia authorization encryption key', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      JUMIA_AUTHORIZATION_ENCRYPTION_KEY: '',
    });

    assert.deepEqual(problems, [
      'JUMIA_AUTHORIZATION_ENCRYPTION_KEY is required',
    ]);
  });

  it('rejects a Jumia authorization key that is not 32 decoded bytes', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      JUMIA_AUTHORIZATION_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
    });

    assert.deepEqual(problems, [
      'JUMIA_AUTHORIZATION_ENCRYPTION_KEY must be Base64-encoded 32 bytes',
    ]);
  });

  it('requires the full quiz production gate', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      QUIZ_PHASE: 'production',
      QUIZ_PRODUCTION_APPROVED: 'true',
    });

    assert.deepEqual(problems, [
      'QUIZ_RPC_SERVER_SECRET is required for production',
      'QUIZ_DEVICE_HASH_PEPPER is required for production',
    ]);
  });

  it('rejects a short production quiz device pepper', () => {
    const problems = getDirectWorkerPreflightProblems({
      ...commonEnv,
      QUIZ_DEVICE_HASH_PEPPER: 'too-short',
      QUIZ_PHASE: 'production',
      QUIZ_PRODUCTION_APPROVED: 'true',
      QUIZ_RPC_SERVER_SECRET: 'rpc-secret',
    });

    assert.deepEqual(problems, [
      'QUIZ_DEVICE_HASH_PEPPER must be at least 32 characters',
    ]);
  });

  it('rejects an unsafe Petrock remediation origin', () => {
    assert.deepEqual(
      getDirectWorkerPreflightProblems({
        ...commonEnv,
        BACI_WEB_BASE_URL: 'http://user:password@usebaci.com',
      }),
      ['BACI_WEB_BASE_URL must be credential-free HTTPS']
    );
  });

  for (const baseUrl of [
    'https://user:password@gigl.example.com',
    'http://gigl.example.com',
  ]) {
    it(`rejects the unsafe GIGL provider origin ${baseUrl}`, () => {
      assert.deepEqual(
        getDirectWorkerPreflightProblems({
          ...commonEnv,
          GIGL_BASE_URL: baseUrl,
        }),
        ['GIGL_BASE_URL must be credential-free HTTPS']
      );
    });
  }

  it('validates the staged file, ignoring inherited process state', () => {
    // The file enables GIGL but omits GIGL_PASSWORD; the process exports
    // GIGL_ENABLED=off plus a provider password. A process-first load
    // would skip every GIGL check and pass — cron would then fail every
    // poll on the file it actually reads.
    const directory = mkdtempSync(join(tmpdir(), 'baci-preflight-'));
    try {
      const dotenvPath = join(directory, '.env');
      const fileEnv = { ...commonEnv };
      delete fileEnv.GIGL_PASSWORD;
      writeFileSync(
        dotenvPath,
        Object.entries(fileEnv)
          .map(([name, value]) => `${name}=${value}`)
          .join('\n')
      );
      const result = spawnSync(
        process.execPath,
        [
          join(
            dirname(fileURLToPath(import.meta.url)),
            'preflight-direct-web-workers.mjs'
          ),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            BACI_WORKER_ENV: dotenvPath,
            GIGL_ENABLED: 'off',
            GIGL_PASSWORD: 'runner-provided-password',
          },
        }
      );

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /GIGL_PASSWORD is required/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('fails the staged-file preflight on a multiline GIGL value', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-preflight-'));
    try {
      const dotenvPath = join(directory, '.env');
      const fileEnv = { ...commonEnv, GIGL_PASSWORD: '"first\nsecond"' };
      const lines = Object.entries(fileEnv).map(([n, v]) => `${n}=${v}`);
      writeFileSync(dotenvPath, lines.join('\n'));
      const script = join(
        dirname(fileURLToPath(import.meta.url)),
        'preflight-direct-web-workers.mjs'
      );
      const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: { ...process.env, BACI_WORKER_ENV: dotenvPath },
      });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(
        result.stderr,
        /GIGL_PASSWORD \(line \d+\) has an unterminated quoted value/
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
