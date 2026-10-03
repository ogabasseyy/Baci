import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const script = join(directory, 'check-gigl-cutover-latch.sh');
const realFilter = join(directory, '..', 'filters', 'deploy.yml');
const temporaryDirectories = [];

export function cleanupLatchFixtures() {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
}

export function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function fixture() {
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
  writeFileSync(join(origin, 'pnpm-lock.yaml'), 'lockfileVersion: v1\n');
  writeFileSync(join(origin, 'package.json'), '{"name":"baci"}\n');
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

  // Manifest-only change: the drift signal keys off installed-vs-HEAD
  // over the manifests group, so the history needs a commit that moves
  // manifests without touching tracking paths.
  writeFileSync(join(origin, 'pnpm-lock.yaml'), 'lockfileVersion: v2\n');
  git(origin, 'add', '-A');
  commit('manifest change');
  const manifest = git(origin, 'rev-parse', 'HEAD');

  writeFileSync(join(origin, 'docs-notes.md'), 'v2\n');
  git(origin, 'add', '-A');
  commit('non-tracking change');
  const tip = git(origin, 'rev-parse', 'HEAD');

  return { base, manifest, origin, remote, root, tip, tracking, trap };
}

export function checkoutAt(origin, root, name, sha) {
  const checkout = join(root, name);
  spawnSync('git', ['clone', '-q', origin, checkout]);
  git(checkout, 'checkout', '-q', sha);
  return checkout;
}

export function tokenFingerprintOf(
  token,
  url = '',
  anon = '',
  base = '',
  email = '',
  password = ''
) {
  // Mirrors resolve-gigl-latch-identity.sh: the credential fingerprint
  // binds URL + anon + provider triple + token (newline-joined, no
  // trailing newline), and a missing token hashes to the well-known
  // empty value (vacuous) regardless of endpoint or provider.
  return createHash('sha256')
    .update(
      token === '' ? '' : `${url}\n${anon}\n${base}\n${email}\n${password}\n${token}`,
      'utf8'
    )
    .digest('hex');
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

export function check({
  latch = null,
  latchLiteral = null,
  scope = 'enabled',
  envFile = null,
  token = undefined,
  url = '',
  anon = '',
  providerBase = '',
  providerEmail = '',
  providerPassword = '',
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
    // rotation/removal since the smoke; pass url/anon/provider* to
    // record the non-token credential set the smoke observed.
    const recorded = token === undefined ? tokenInEnvFile(envFile) : token;
    writeFileSync(
      join(remote, '.gigl-capability-smoke-ok'),
      `${scope}:${latch}:${tokenFingerprintOf(recorded, url, anon, providerBase, providerEmail, providerPassword)}`
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
  // Hermetic identity: the check runs the real resolver in default
  // (caller-wins) mode, so runner exports must not leak into the
  // fixture fingerprint.
  delete env.GIGL_ENABLED;
  delete env.GIGL_TRACKING_WORKER_TOKEN;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.NEXT_PUBLIC_SUPABASE_URL;
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
