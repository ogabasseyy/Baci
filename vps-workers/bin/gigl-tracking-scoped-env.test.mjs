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

const EXPECTED_PASSWORD = "p#a s$s`x'y\\\\z";

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

// Secrets a caller environment may already carry (cron daemon, SSH
// session, self-hosted runner service, CI step env). The exec boundary
// must drop all of them even though they are exported before scoping.
const ADVERSARIAL_CALLER_ENV = {
  GITHUB_TOKEN: 'ghs_runner-secret',
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

function parseChildEnv(stdout) {
  const entries = stdout.split('\0').filter((line) => line !== '');
  return Object.fromEntries(
    entries.map((line) => {
      const separator = line.indexOf('=');
      assert.notEqual(separator, -1, `malformed env line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
  );
}

function expectedChildEnv(overrides = {}) {
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

describe('gigl-tracking-scoped-env', () => {
  it('execs the child with exactly the allowlist environment', () => {
    const result = runFilterProbe({ sharedEnv: SHARED_ENV_FIXTURE });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(parseChildEnv(result.stdout), expectedChildEnv());
  });

  it('drops caller-exported secrets at the exec boundary', () => {
    const result = runFilterProbe({ sharedEnv: SHARED_ENV_FIXTURE });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const childEnv = parseChildEnv(result.stdout);
    for (const leaked of Object.keys(ADVERSARIAL_CALLER_ENV)) {
      assert.equal(
        Object.hasOwn(childEnv, leaked),
        false,
        `caller secret reached the child: ${leaked}`
      );
    }
    // The probe's own bookkeeping must not reach the child either.
    assert.equal(Object.hasOwn(childEnv, 'FILTER_UNDER_TEST'), false);
    assert.equal(Object.hasOwn(childEnv, 'GIGL_SCOPED_ENV_NAMES'), false);
  });

  it('lets a caller-set value win over the file (dotenv precedence)', () => {
    const result = runFilterProbe({
      sharedEnv: SHARED_ENV_FIXTURE,
      extraEnv: { GIGL_EMAIL: 'caller-override@example.com' },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(
      parseChildEnv(result.stdout),
      expectedChildEnv({ GIGL_EMAIL: 'caller-override@example.com' })
    );
  });

  it('lets the file win in file-authoritative mode', () => {
    const result = runFilterProbe({
      sharedEnv: SHARED_ENV_FIXTURE,
      extraEnv: {
        GIGL_EMAIL: 'caller-override@example.com',
        GIGL_ENV_FILE_AUTHORITATIVE: '1',
      },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(parseChildEnv(result.stdout), expectedChildEnv());
  });

  it('passes caller-only GIGL knobs in default mode', () => {
    const result = runFilterProbe({
      sharedEnv: SHARED_ENV_FIXTURE,
      extraEnv: { GIGL_TRACKING_TIMEOUT_MS: '10000' },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(
      parseChildEnv(result.stdout),
      expectedChildEnv({ GIGL_TRACKING_TIMEOUT_MS: '10000' })
    );
  });

  it('drops caller-only GIGL knobs in file-authoritative mode', () => {
    const result = runFilterProbe({
      sharedEnv: SHARED_ENV_FIXTURE,
      extraEnv: {
        GIGL_ENV_FILE_AUTHORITATIVE: '1',
        GIGL_TRACKING_TIMEOUT_MS: '10000',
      },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(parseChildEnv(result.stdout), expectedChildEnv());
  });

  it('never passes the mode flag itself to the child', () => {
    const result = runFilterProbe({
      sharedEnv: SHARED_ENV_FIXTURE,
      extraEnv: { GIGL_ENV_FILE_AUTHORITATIVE: '0' },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(parseChildEnv(result.stdout), expectedChildEnv());
  });

  it('drops file-absent caller values in file-authoritative mode', () => {
    const fileWithoutUrl = SHARED_ENV_FIXTURE.replace(
      'NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co\n',
      ''
    );
    const result = runFilterProbe({
      sharedEnv: fileWithoutUrl,
      extraEnv: {
        GIGL_ENV_FILE_AUTHORITATIVE: '1',
        NEXT_PUBLIC_SUPABASE_URL: 'https://runner.example.com',
      },
    });
    const expected = expectedChildEnv();
    delete expected.NEXT_PUBLIC_SUPABASE_URL;

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(parseChildEnv(result.stdout), expected);
  });

  it('fails closed when the shared env file is missing', () => {
    const result = runFilterProbe({ sharedEnv: null });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing shared worker env file/);
  });

  it('refuses to exec before scoping', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        '. "$1"; gigl_tracking_exec_scoped true',
        'probe',
        join(binDir, 'gigl-tracking-scoped-env.sh'),
      ],
      { encoding: 'utf8' }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must run before gigl_tracking_exec_scoped/);
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
      const execIndex = source.indexOf('gigl_tracking_exec_scoped');
      const delegateIndex = source.indexOf(
        `run-web-script.sh" ${label} ${script}`
      );

      assert.notEqual(sourceIndex, -1);
      assert.notEqual(callIndex, -1);
      assert.notEqual(execIndex, -1);
      assert.notEqual(delegateIndex, -1);
      assert.ok(sourceIndex < callIndex);
      assert.ok(callIndex < execIndex);
      assert.ok(execIndex < delegateIndex);
    });
  }

  it('runs the smoke entry in file-authoritative mode', () => {
    const source = readFileSync(
      join(binDir, 'verify-gigl-tracking-worker-capability.sh'),
      'utf8'
    );
    const modeIndex = source.indexOf('export GIGL_ENV_FILE_AUTHORITATIVE=1');
    const callIndex = source.indexOf('gigl_tracking_scope_env');

    assert.notEqual(modeIndex, -1);
    assert.notEqual(callIndex, -1);
    assert.ok(modeIndex < callIndex);
  });

  it('ships the shared dotenv reader to the VPS next to the filter', () => {
    const releaseHelper = readFileSync(
      join(workerRoot, 'lib', 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(
      releaseHelper,
      /\.github\/scripts\/gigl-dotenv\.sh" "\$VPS:\$STAGING_DIR\/bin\/gigl-dotenv\.sh/
    );
  });
});
