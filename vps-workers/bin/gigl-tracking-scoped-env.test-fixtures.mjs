import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const binDir = dirname(fileURLToPath(import.meta.url));
export const workerRoot = join(binDir, '..');
const repoRoot = join(workerRoot, '..');

const EXPECTED_PASSWORD = "p#a s$s`x'y\\\\z";

export const SHARED_ENV_FIXTURE = [
  '#GIGL_COMMENTED_OUT=smuggled',
  'GIGL_ENABLED=1',
  'GIGL_BASE_URL=https://api.gigl.example # trailing comment',
  'GIGL_EMAIL=gigl-poller@example.com',
  'GIGL_PASSWORD="p#a s$s`x\'y\\\\z" # tricky',
  'GIGL_TRACKING_WORKER_TOKEN=aaa.bbb.ccc',
  'GIGL_TRACKING_BATCH_TIMEOUT_MS=5000',
  'export GIGL_QUOTE_TIMEOUT_MS=7000',
  'GIGL_DUP=first',
  'GIGL_DUP=second',
  'MYGIGL_NOT_NAMESPACE=smuggled',
  'NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key-value',
  'BACI_REPO_DIR=/opt/baci/app',
  'SUPABASE_SERVICE_ROLE_KEY=service-role-secret',
  'PETROCK_API_TOKEN=petrock-secret',
  'INTERNAL_API_SECRET=internal-secret',
  'ZEPTOMAIL_TOKEN=zeptomail-secret',
  'QUIZ_RPC_SERVER_SECRET=quiz-secret',
  'JUMIA_AUTHORIZATION_ENCRYPTION_KEY=jumia-secret',
  '',
].join('\n');

// Secrets a caller environment may already carry (cron daemon, SSH
// session, self-hosted runner service, CI step env). The exec boundary
// must drop all of them even though they are exported before scoping.
export const ADVERSARIAL_CALLER_ENV = {
  GITHUB_TOKEN: '[REDACTED]',
  JUMIA_AUTHORIZATION_ENCRYPTION_KEY: 'caller-jumia-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'caller-service-role-secret',
};

// The probe execs into `env -0` through the same helper the entries use,
// so the assertions below observe the CHILD environment, not the
// pre-exec shell. NUL separation keeps tricky values unambiguous.
const PROBE_SCRIPT = [
  'set -u',
  '. "$FILTER_UNDER_TEST"',
  'gigl_tracking_scope_env',
  'gigl_tracking_exec_scoped env -0',
].join('\n');

export function runFilterProbe({ extraEnv = {}, sharedEnv = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-gigl-scoped-env-'));
  try {
    const filterCopy = join(directory, 'gigl-tracking-scoped-env.sh');
    copyFileSync(join(binDir, 'gigl-tracking-scoped-env.sh'), filterCopy);
    // Mirror prepare-worker-release.sh: the reader ships next to the filter.
    copyFileSync(
      join(repoRoot, '.github', 'scripts', 'gigl-dotenv.sh'),
      join(directory, 'gigl-dotenv.sh')
    );
    const sharedEnvPath = join(directory, 'shared.env');
    if (sharedEnv !== null) {
      writeFileSync(sharedEnvPath, sharedEnv);
    }
    return spawnSync('bash', ['-c', PROBE_SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_WORKER_ENV: sharedEnvPath,
        BACI_WORKER_PROFILE: 'gigl-tracking',
        FILTER_UNDER_TEST: filterCopy,
        NODE_ENV: 'production',
        ...ADVERSARIAL_CALLER_ENV,
        ...extraEnv,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

export function parseChildEnv(stdout) {
  const entries = stdout.split('\0').filter((line) => line !== '');
  return Object.fromEntries(
    entries.map((line) => {
      const separator = line.indexOf('=');
      assert.notEqual(separator, -1, `malformed env line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
  );
}

export function expectedChildEnv(overrides = {}) {
  // Unset infrastructure names stay absent (the exec helper skips them),
  // so only expect HOME/PATH when the runner actually exports them.
  const expected = {
    BACI_REPO_DIR: '/opt/baci/app',
    BACI_WORKER_ENV: '/dev/null',
    BACI_WORKER_PROFILE: 'gigl-tracking',
    GIGL_BASE_URL: 'https://api.gigl.example',
    GIGL_DUP: 'second',
    GIGL_EMAIL: 'gigl-poller@example.com',
    GIGL_ENABLED: '1',
    GIGL_PASSWORD: EXPECTED_PASSWORD,
    GIGL_QUOTE_TIMEOUT_MS: '7000',
    GIGL_TRACKING_BATCH_TIMEOUT_MS: '5000',
    GIGL_TRACKING_WORKER_TOKEN: 'aaa.bbb.ccc',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NODE_ENV: 'production',
  };
  for (const name of ['HOME', 'PATH']) {
    if (process.env[name] !== undefined) {
      expected[name] = process.env[name];
    }
  }
  return { ...expected, ...overrides };
}
