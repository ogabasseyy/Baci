import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
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

function check({ latch = null, checkout }) {
  const root = dirname(checkout);
  const remote = join(root, 'workers');
  const trap = join(root, 'trap-cwd');
  if (latch !== null) {
    writeFileSync(join(remote, '.gigl-capability-smoke-ok'), latch);
  }
  const output = join(root, 'github-output.env');
  writeFileSync(output, '');
  const result = spawnSync('bash', [script, remote, checkout], {
    cwd: trap,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_TOKEN: '' },
  });
  const values = Object.fromEntries(
    readFileSync(output, 'utf8')
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

    const { result, values } = check({ checkout, latch: 'not-a-sha' });

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

    const { result, values } = check({ checkout, latch: '0'.repeat(40) });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'true');
  });
});
