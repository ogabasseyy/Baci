import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const libDir = dirname(fileURLToPath(import.meta.url));
const provisionScript = join(libDir, 'provision-immutable-checkout.sh');
const flipScript = join(libDir, 'flip-immutable-checkout.sh');

const TS_ENTRYPOINTS = [
  'apps/web/src/scripts/process-gigl-tracking.ts',
  'apps/web/src/scripts/process-petrock-reconciliation.ts',
  'apps/web/src/scripts/process-quiz-finalization.ts',
];
const WRAPPERS = [
  'process-gigl-tracking.sh',
  'verify-gigl-tracking-worker-capability.sh',
  'process-petrock-reconciliation.sh',
  'process-quiz-finalization.sh',
];
const TSX_STUB = '#!/usr/bin/env bash\necho "tsx-stub"\n';

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'baci-test',
  GIT_AUTHOR_EMAIL: 'baci-test@example.com',
  GIT_COMMITTER_NAME: 'baci-test',
  GIT_COMMITTER_EMAIL: 'baci-test@example.com',
};

function git(args, cwd, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...gitEnv, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let fixtureRoots = [];
afterEach(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { force: true, recursive: true });
  }
  fixtureRoots = [];
});

// Builds a fixture VPS layout: an origin repo with commits carrying
// distinct marker content, a legacy object-source clone, and worker
// staging/remote dirs. Every commit carries the TS entrypoints and a
// tsx stub unless withTsx is false for that commit.
function fixture({ commits }) {
  const root = mkdtempSync(join(tmpdir(), 'baci-immutable-'));
  fixtureRoots.push(root);
  const origin = join(root, 'origin');
  mkdirSync(origin, { recursive: true });
  git(['init', '-b', 'main', '--quiet'], origin);

  const shas = [];
  for (const [index, commit] of commits.entries()) {
    writeFileSync(join(origin, 'marker.txt'), `revision-${index}\n`);
    for (const entrypoint of TS_ENTRYPOINTS) {
      const path = join(origin, entrypoint);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '// entrypoint\n');
    }
    if (commit.withTsx !== false) {
      const tsxPath = join(
        origin,
        'apps',
        'web',
        'node_modules',
        '.bin',
        'tsx'
      );
      mkdirSync(dirname(tsxPath), { recursive: true });
      writeFileSync(tsxPath, TSX_STUB);
      chmodSync(tsxPath, 0o755);
    }
    git(['add', '-A'], origin);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', `revision ${index}`], origin);
    shas.push(git(['rev-parse', 'HEAD'], origin));
  }

  const base = join(root, 'base');
  mkdirSync(base, { recursive: true });
  const legacy = join(base, 'app');
  git(['clone', '--quiet', origin, legacy], root);

  const staging = join(root, 'staging');
  mkdirSync(join(staging, 'bin'), { recursive: true });
  writeFileSync(join(staging, '.env'), `BACI_REPO_DIR=${legacy}\n`);
  for (const wrapper of WRAPPERS) {
    const path = join(staging, 'bin', wrapper);
    writeFileSync(path, '#!/usr/bin/env bash\n');
    chmodSync(path, 0o755);
  }

  const remote = join(root, 'remote');
  mkdirSync(remote, { recursive: true });
  writeFileSync(join(remote, '.env'), `BACI_REPO_DIR=${legacy}\n`);

  return { base, legacy, origin, remote, root, staging, shas };
}

function runScript(script, args, extraEnv = {}) {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...gitEnv, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? '').trim(),
    };
  }
}

describe('immutable per-SHA checkouts', () => {
  it('provisions a detached worktree at the deploying SHA', () => {
    const { base, shas, staging } = fixture({
      commits: [{}, {}],
    });

    const result = runScript(provisionScript, [staging, shas[1]]);

    assert.equal(result.status, 0, result.stderr);
    const immutable = join(base, `app-${shas[1]}`);
    assert.equal(result.stdout, immutable);
    assert.equal(git(['rev-parse', 'HEAD'], immutable), shas[1]);
    assert.equal(
      readFileSync(join(immutable, 'marker.txt'), 'utf8'),
      'revision-1\n'
    );
    // Staging .env is re-pointed so the smoke verifies the candidate.
    assert.match(
      readFileSync(join(staging, '.env'), 'utf8'),
      new RegExp(`^BACI_REPO_DIR=${immutable}$`, 'm')
    );
  });

  it('provisions idempotently for deploy retries', () => {
    const { shas, staging } = fixture({ commits: [{}] });

    assert.equal(runScript(provisionScript, [staging, shas[0]]).status, 0);
    const retry = runScript(provisionScript, [staging, shas[0]]);

    assert.equal(retry.status, 0, retry.stderr);
  });

  it('fails closed when the SHA cannot be fetched', () => {
    const { staging } = fixture({ commits: [{}] });

    const result = runScript(provisionScript, [
      staging,
      '0123456789abcdef0123456789abcdef01234567',
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /push the deploying commit first/);
  });

  it('fails closed when the provisioned checkout is dirty', () => {
    const { base, shas, staging } = fixture({ commits: [{}] });

    assert.equal(runScript(provisionScript, [staging, shas[0]]).status, 0);
    writeFileSync(join(base, `app-${shas[0]}`, 'tampered.txt'), 'x\n');

    const retry = runScript(provisionScript, [staging, shas[0]]);

    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /checkout is dirty/);
  });

  it('installs dependencies only when the toolchain is absent', () => {
    const { shas, staging, root } = fixture({
      commits: [{ withTsx: false }, {}],
    });
    const binDir = join(root, 'stub-bin');
    mkdirSync(binDir, { recursive: true });
    const pnpmLog = join(root, 'pnpm-calls.log');
    writeFileSync(
      join(binDir, 'pnpm'),
      [
        '#!/usr/bin/env bash',
        'echo "$*" >> "$PNPM_CALLS_LOG"',
        'mkdir -p apps/web/node_modules/.bin',
        "printf '#!/usr/bin/env bash\\necho tsx-stub\\n' > apps/web/node_modules/.bin/tsx",
        'chmod +x apps/web/node_modules/.bin/tsx',
        '',
      ].join('\n')
    );
    chmodSync(join(binDir, 'pnpm'), 0o755);
    const stubPath = `${binDir}:${process.env.PATH ?? ''}`;

    const installed = runScript(provisionScript, [staging, shas[0]], {
      PATH: stubPath,
      PNPM_CALLS_LOG: pnpmLog,
    });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(
      readFileSync(pnpmLog, 'utf8'),
      /install --frozen-lockfile/
    );

    rmSync(pnpmLog, { force: true });
    const cached = runScript(provisionScript, [staging, shas[1]], {
      PATH: stubPath,
      PNPM_CALLS_LOG: pnpmLog,
    });
    assert.equal(cached.status, 0, cached.stderr);
    assert.equal(existsSync(pnpmLog), false);
  });

  it('migrates the legacy checkout to the release symlink once', () => {
    const { base, legacy, remote, shas, staging } = fixture({
      commits: [{}, {}],
    });
    assert.equal(runScript(provisionScript, [staging, shas[1]]).status, 0);

    const result = runScript(flipScript, [remote, shas[1]]);

    assert.equal(result.status, 0, result.stderr);
    const live = join(base, 'app-live');
    assert.equal(lstatSync(live).isSymbolicLink(), true);
    assert.equal(readlinkSync(live), join(base, `app-${shas[1]}`));
    // git resolves through the symlink: the install verifier and cron
    // keep working with no path changes.
    assert.equal(git(['rev-parse', 'HEAD'], live), shas[1]);
    assert.equal(readFileSync(join(live, 'marker.txt'), 'utf8'), 'revision-1\n');
    // Live .env now names the symlink; the legacy clone stays frozen
    // as the object source.
    assert.match(
      readFileSync(join(remote, '.env'), 'utf8'),
      new RegExp(`^BACI_REPO_DIR=${live}$`, 'm')
    );
    assert.equal(
      git(['rev-parse', '--is-inside-work-tree'], legacy).trim(),
      'true'
    );
  });

  it('flips steady-state releases and retires only old checkouts', () => {
    const { base, remote, shas, staging } = fixture({
      commits: [{}, {}, {}],
    });
    const [shaA, shaB, shaC] = shas;
    const dirA = join(base, `app-${shaA}`);
    const dirB = join(base, `app-${shaB}`);
    const dirC = join(base, `app-${shaC}`);
    // Each deploy copies the live .env fresh; mirror that so later
    // provisions resolve BACI_REPO_DIR through the release symlink.
    const refreshStagingEnv = () => {
      writeFileSync(
        join(staging, '.env'),
        readFileSync(join(remote, '.env'), 'utf8')
      );
    };

    assert.equal(runScript(provisionScript, [staging, shaA]).status, 0);
    assert.equal(runScript(flipScript, [remote, shaA]).status, 0);
    // Age A past the rapid-redeploy guard.
    execFileSync('touch', ['-t', '202001010000', dirA]);

    refreshStagingEnv();
    assert.equal(runScript(provisionScript, [staging, shaB]).status, 0);
    assert.equal(runScript(flipScript, [remote, shaB]).status, 0);
    // B is current, A is previous: both stay.
    assert.equal(existsSync(dirA), true);
    assert.equal(existsSync(dirB), true);

    refreshStagingEnv();
    assert.equal(runScript(provisionScript, [staging, shaC]).status, 0);
    assert.equal(runScript(flipScript, [remote, shaC]).status, 0);
    // A is older than previous and aged: retired. The release link,
    // the legacy clone, and B/C survive.
    assert.equal(existsSync(dirA), false);
    assert.equal(existsSync(dirB), true);
    assert.equal(existsSync(dirC), true);
    assert.equal(readlinkSync(join(base, 'app-live')), dirC);
    assert.equal(existsSync(join(base, 'app')), true);
    assert.equal(
      git(['worktree', 'list', '--porcelain'], dirC).includes(dirA),
      false
    );
  });

  it('refuses to flip to a missing or mismatched checkout', () => {
    const { remote, shas, staging } = fixture({ commits: [{}] });
    assert.equal(runScript(provisionScript, [staging, shas[0]]).status, 0);

    const missing = runScript(flipScript, [
      remote,
      '0123456789abcdef0123456789abcdef01234567',
    ]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Immutable checkout .* is missing/);
  });
});
