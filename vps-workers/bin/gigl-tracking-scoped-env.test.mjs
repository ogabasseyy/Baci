import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ADVERSARIAL_CALLER_ENV,
  binDir,
  expectedChildEnv,
  parseChildEnv,
  runFilterProbe,
  SHARED_ENV_FIXTURE,
  workerRoot,
} from './gigl-tracking-scoped-env.test-fixtures.mjs';

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

  it('ignores a mode-flag line in the file (caller owns the mode)', () => {
    // A `GIGL_ENV_FILE_AUTHORITATIVE=0` file line must not flip the
    // mode mid-loop: candidates sorted after it (like GIGL_PASSWORD)
    // would otherwise read caller exports instead of the file, and
    // the smoke would certify runner-injected values.
    const result = runFilterProbe({
      sharedEnv: `${SHARED_ENV_FIXTURE}\nGIGL_ENV_FILE_AUTHORITATIVE=0\n`,
      extraEnv: {
        GIGL_ENV_FILE_AUTHORITATIVE: '1',
        GIGL_PASSWORD: 'caller-override-password',
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
