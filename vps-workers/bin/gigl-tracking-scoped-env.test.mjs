import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const binDir = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(binDir, '..');
const repoRoot = join(workerRoot, '..');

const EXPECTED_PASSWORD = 'p#a s$s`x\'y\\\\z';

const SHARED_ENV_FIXTURE = [
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

const PROBE_SCRIPT = [
  'set -u',
  '. "$FILTER_UNDER_TEST"',
  'gigl_tracking_scope_env',
  'fail=0',
  'check_exported() {',
  '  if ! printenv "$1" >/dev/null 2>&1; then echo "MISSING:$1"; fail=1; return; fi',
  '  actual="$(printenv "$1")"',
  '  if [ "$actual" != "$2" ]; then echo "MISMATCH:$1"; fail=1; fi',
  '}',
  'check_absent() {',
  '  if printenv "$1" >/dev/null 2>&1; then echo "LEAKED:$1"; fail=1; fi',
  '}',
  'check_exported GIGL_ENABLED 1',
  'check_exported GIGL_BASE_URL https://api.gigl.example',
  'check_exported GIGL_EMAIL "$FILTER_EXPECT_EMAIL"',
  'check_exported GIGL_PASSWORD "$FILTER_EXPECT_PASSWORD"',
  'check_exported GIGL_TRACKING_WORKER_TOKEN aaa.bbb.ccc',
  'check_exported GIGL_TRACKING_BATCH_TIMEOUT_MS 5000',
  'check_exported GIGL_QUOTE_TIMEOUT_MS 7000',
  'check_exported GIGL_DUP second',
  'check_exported NEXT_PUBLIC_SUPABASE_URL https://project.supabase.co',
  'check_exported NEXT_PUBLIC_SUPABASE_ANON_KEY anon-key-value',
  'check_exported BACI_REPO_DIR /opt/baci/app',
  'check_exported BACI_WORKER_ENV /dev/null',
  'check_absent GIGL_COMMENTED_OUT',
  'check_absent MYGIGL_NOT_NAMESPACE',
  'check_absent SUPABASE_SERVICE_ROLE_KEY',
  'check_absent PETROCK_API_TOKEN',
  'check_absent INTERNAL_API_SECRET',
  'check_absent ZEPTOMAIL_TOKEN',
  'check_absent QUIZ_RPC_SERVER_SECRET',
  'check_absent JUMIA_AUTHORIZATION_ENCRYPTION_KEY',
  // Caller-exported infrastructure passes through untouched.
  'check_exported NODE_ENV production',
  'check_exported BACI_WORKER_PROFILE gigl-tracking',
  'exit $fail',
].join('\n');

function runFilterProbe({ extraEnv = {}, sharedEnv = null } = {}) {
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
        FILTER_EXPECT_EMAIL: 'gigl-poller@example.com',
        FILTER_EXPECT_PASSWORD: EXPECTED_PASSWORD,
        FILTER_UNDER_TEST: filterCopy,
        NODE_ENV: 'production',
        ...extraEnv,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('gigl-tracking-scoped-env', () => {
  it('exports only the GIGL allowlist and unpoints the shared dotenv', () => {
    const result = runFilterProbe({ sharedEnv: SHARED_ENV_FIXTURE });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout, '');
  });

  it('lets a caller-set value win over the file (dotenv precedence)', () => {
    const result = runFilterProbe({
      sharedEnv: SHARED_ENV_FIXTURE,
      extraEnv: {
        FILTER_EXPECT_EMAIL: 'caller-override@example.com',
        GIGL_EMAIL: 'caller-override@example.com',
      },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout, '');
  });

  it('fails closed when the shared env file is missing', () => {
    const result = runFilterProbe({ sharedEnv: null });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing shared worker env file/);
  });

  it('refuses direct execution', () => {
    const result = spawnSync(
      'bash',
      [join(binDir, 'gigl-tracking-scoped-env.sh')],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /must be sourced, not executed/);
  });

  for (const [entry, label, script] of [
    [
      'process-gigl-tracking.sh',
      'gigl-tracking',
      'src/scripts/process-gigl-tracking.ts',
    ],
    [
      'verify-gigl-tracking-worker-capability.sh',
      'gigl-capability',
      'src/scripts/verify-gigl-tracking-worker-capability.ts',
    ],
  ]) {
    it(`${entry} scopes its environment before delegating`, () => {
      const source = readFileSync(join(binDir, entry), 'utf8');
      const sourceIndex = source.indexOf('gigl-tracking-scoped-env.sh');
      const callIndex = source.indexOf('gigl_tracking_scope_env');
      const execIndex = source.indexOf(
        `run-web-script.sh" ${label} ${script}`
      );

      assert.notEqual(sourceIndex, -1);
      assert.notEqual(callIndex, -1);
      assert.notEqual(execIndex, -1);
      assert.ok(sourceIndex < callIndex);
      assert.ok(callIndex < execIndex);
    });
  }

  it('ships the shared dotenv reader to the VPS next to the filter', () => {
    const releaseHelper = readFileSync(
      join(workerRoot, 'lib', 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(
      releaseHelper,
      /\.github\/scripts\/gigl-dotenv\.sh"\ "\$VPS:\$STAGING_DIR\/bin\/gigl-dotenv\.sh/
    );
  });
});
