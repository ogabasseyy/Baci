import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const script = join(directory, 'check-gigl-cutover-latch.sh');
const realFilter = join(directory, '..', 'filters', 'deploy.yml');
const temporaryDirectories = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baci-gigl-latch-'));
  temporaryDirectories.push(root);
  const origin = join(root, 'origin');
  const remote = join(root, 'workers');
  // Trap cwd: files matching the real filter globs. If the script ever
  // lets the shell expand tracking patterns, the diff sees these trap
  // paths (absent from the fixture repo) instead of literal pathspecs.
  const trap = join(root, 'trap-cwd');
  for (const trapFile of [
    'supabase/migrations/999gigl-trap.ts',
    'apps/web/src/lib/shipping/gigl-trap.ts',
    'apps/web/src/lib/shipping/providers/gigl-trap.ts',
    'apps/web/src/app/api/cron/gigl-tracking/trap.ts',
  ]) {
    const full = join(trap, trapFile);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'trap\n');
  }
  mkdirSync(join(origin, '.github', 'filters'), { recursive: true });
  mkdirSync(remote, { recursive: true });
  copyFileSync(realFilter, join(origin, '.github', 'filters', 'deploy.yml'));

  spawnSync('git', ['init', '-q', '-b', 'main', origin]);
  const commit = (message) =>
    git(
      origin,
      '-c',
      'user.email=latch@test',
      '-c',
      'user.name=latch',
      'commit',
      '-q',
      '-m',
      message
    );
  mkdirSync(join(origin, 'vps-workers'), { recursive: true });
  writeFileSync(join(origin, 'vps-workers', 'deploy.sh'), 'v1\n');
  mkdirSync(join(origin, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(
    join(origin, 'supabase', 'migrations', '111gigl-fixture.sql'),
    'select 1;\n'
  );
  writeFileSync(join(origin, 'docs-notes.md'), 'v1\n');
  git(origin, 'add', '-A');
  commit('base');
  const base = git(origin, 'rev-parse', 'HEAD');

  // The tracking change touches a GLOB-covered pattern
  // (supabase/migrations/*gigl*): without noglob, the trap cwd expands the
  // pattern away and this change is silently dropped from the diff.
  writeFileSync(
    join(origin, 'supabase', 'migrations', '111gigl-fixture.sql'),
    'select 2;\n'
  );
  git(origin, 'add', '-A');
  commit('tracking change');
  const tracking = git(origin, 'rev-parse', 'HEAD');

  writeFileSync(join(origin, 'docs-notes.md'), 'v2\n');
  git(origin, 'add', '-A');
  commit('non-tracking change');
  const tip = git(origin, 'rev-parse', 'HEAD');

  return { base, origin, remote, root, tip, tracking, trap };
}

function checkoutAt(origin, root, name, sha) {
  const checkout = join(root, name);
  spawnSync('git', ['clone', '-q', origin, checkout]);
  git(checkout, 'checkout', '-q', sha);
  return checkout;
}

function tokenFingerprintOf(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tokenInEnvFile(envFile) {
  if (envFile === null) return '';
  for (const line of envFile.split('\n')) {
    if (line.startsWith('GIGL_TRACKING_WORKER_TOKEN=')) {
      let value = line.slice('GIGL_TRACKING_WORKER_TOKEN='.length);
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  return '';
}

function check({
  latch = null,
  latchLiteral = null,
  scope = 'enabled',
  envFile = null,
  token = undefined,
  installed = undefined,
  omitOutput = false,
  githubToken = '',
  extraPath = null,
  checkout,
}) {
  const root = dirname(checkout);
  const remote = join(root, 'workers');
  const trap = join(root, 'trap-cwd');
  if (envFile !== null) {
    writeFileSync(join(remote, '.env'), envFile);
  }
  if (latchLiteral !== null) {
    writeFileSync(join(remote, '.gigl-capability-smoke-ok'), latchLiteral);
  } else if (latch !== null) {
    // Default: the latch records the token the fixture .env currently
    // holds (the steady state). Pass an explicit token to simulate a
    // rotation/removal since the smoke.
    const recorded = token === undefined ? tokenInEnvFile(envFile) : token;
    writeFileSync(
      join(remote, '.gigl-capability-smoke-ok'),
      `${scope}:${latch}:${tokenFingerprintOf(recorded)}`
    );
  }
  // Default: installed == latch (the bound steady state). Pass an explicit
  // SHA to simulate drift, or null to simulate a missing marker file.
  const installedSha = installed === undefined ? latch : installed;
  if (installedSha !== null) {
    writeFileSync(join(remote, 'app-checkout.sha'), installedSha);
  }
  const output = join(root, 'github-output.env');
  writeFileSync(output, '');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: output,
    GITHUB_TOKEN: githubToken,
  };
  if (omitOutput) {
    delete env.GITHUB_OUTPUT;
  }
  if (extraPath !== null) {
    env.PATH = `${extraPath}:${process.env.PATH}`;
  }
  const result = spawnSync('bash', [script, remote, checkout], {
    cwd: trap,
    encoding: 'utf8',
    env,
  });
  const raw = omitOutput ? result.stdout : readFileSync(output, 'utf8');
  const values = Object.fromEntries(
    raw
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
  return { result, values };
}

describe('GIGL cutover latch check', () => {
  it('reports unlatched when the smoke never succeeded', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports unlatched when the latch file is corrupt', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout, latchLiteral: 'not-a-sha' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports fresh when the latch matches HEAD', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout, latch: tip });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('reports stale when tracking paths changed since the latch', () => {
    const { origin, root, tip, base } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({ checkout, latch: base });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports fresh when only untracked paths changed since the latch', () => {
    const { origin, root, tip, tracking } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // tip adds docs-notes.md on top of the tracking commit: no tracking
    // diff between the latch and HEAD.
    const { result, values } = check({ checkout, latch: tracking });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('fails closed when the latched revision cannot be fetched', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);
    const missing = '0'.repeat(40);

    const { result, values } = check({
      checkout,
      latch: missing,
      installed: missing,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'true');
  });

  it('never passes the job token on the git command line', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);
    const realGit = spawnSync('/bin/sh', ['-c', 'command -v git'], {
      encoding: 'utf8',
    }).stdout.trim();
    assert.ok(realGit.length > 0, 'expected to resolve a real git binary');
    const binDir = join(root, 'shim-bin');
    const argvLog = join(root, 'git-argv.log');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(argvLog, '');
    const shim = join(binDir, 'git');
    writeFileSync(
      shim,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argvLog}"\nexec "${realGit}" "$@"\n`
    );
    chmodSync(shim, 0o755);

    const sentinel = 'sentinel_job_token_for_argv_assertion';
    const { result, values } = check({
      checkout,
      latch: tip,
      githubToken: sentinel,
      extraPath: binDir,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
    const argvLines = readFileSync(argvLog, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    assert.ok(
      argvLines.some((line) => line.includes('fetch')),
      `expected a fetch invocation, saw: ${argvLines.join('; ')}`
    );
    assert.ok(
      !argvLines.some((line) => line.includes(sentinel)),
      'job token must not appear in git argv'
    );
  });

  it('reports unlatched when a promote replaced the smoked worker', () => {
    const { origin, root, tip, base } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Rollback/manual-promote drift: latch proves tip, installed is base.
    // The tracking diff tip..tip is empty, so only the installed-SHA
    // binding fails closed here.
    const { result, values } = check({
      checkout,
      latch: tip,
      installed: base,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports unlatched when the installed SHA marker is missing', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      installed: null,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('reports unlatched when the installed SHA marker is corrupt', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      installed: 'not-a-sha',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('emits the signal on stdout when GITHUB_OUTPUT is unset', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      omitOutput: true,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('rejects the pre-scoped bare-SHA latch format', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latchLiteral: tip,
      installed: tip,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('rejects a latch with an unknown scope', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latchLiteral: `bogus:${tip}:` + '1'.repeat(64),
      installed: tip,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('accepts a disabled latch while the worker is still disabled', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=off\n',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('invalidates a disabled latch once the worker is re-enabled', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Same latch content as the steady-disabled case; only the live .env
    // changed. A disabled smoke must never certify future enabled
    // function, so only the scope re-check fails closed here.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=1\nGIGL_TRACKING_WORKER_TOKEN=aaa.bbb.ccc\n',
      token: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates a disabled latch when the env file disappears', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Absent .env means enabled, which mismatches the disabled scope.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates an enabled latch once the worker is disabled', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Scope must match in BOTH directions: without this, a
    // disable/re-enable cycle between latch and push would bypass the
    // smoke on an unproven token.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile: 'GIGL_ENABLED=false\n',
      token: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates an enabled latch when the token rotates', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile: 'GIGL_TRACKING_WORKER_TOKEN=new-token\n',
      token: 'old-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates an enabled latch when the token is removed', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile: 'GIGL_ENABLED=1\n',
      token: 'old-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('ignores token changes on a disabled latch', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Provisioning a token while disabled must not freeze web deploys;
    // the still-disabled scope check alone authorizes the vacuous bypass.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=off\nGIGL_TRACKING_WORKER_TOKEN=new-token\n',
      token: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });
});
