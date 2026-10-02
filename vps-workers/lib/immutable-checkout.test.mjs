import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cleanupImmutableCheckoutFixtures,
  git,
  immutableCheckoutFixture,
  runCheckoutScript,
} from './immutable-checkout.test-fixtures.mjs';

const libDir = dirname(fileURLToPath(import.meta.url));
const provisionScript = join(libDir, 'provision-immutable-checkout.sh');
const flipScript = join(libDir, 'flip-immutable-checkout.sh');

afterEach(cleanupImmutableCheckoutFixtures);

describe('immutable per-SHA checkouts', () => {
  it('provisions a detached worktree at the deploying SHA', () => {
    const { base, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}],
    });

    const result = runCheckoutScript(provisionScript, [staging, shas[1]]);

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
    const { shas, staging } = immutableCheckoutFixture({ commits: [{}] });

    assert.equal(runCheckoutScript(provisionScript, [staging, shas[0]]).status, 0);
    const retry = runCheckoutScript(provisionScript, [staging, shas[0]]);

    assert.equal(retry.status, 0, retry.stderr);
  });

  it('fails closed when the SHA cannot be fetched', () => {
    const { staging } = immutableCheckoutFixture({ commits: [{}] });

    const result = runCheckoutScript(provisionScript, [
      staging,
      '0123456789abcdef0123456789abcdef01234567',
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /push the deploying commit first/);
  });

  it('fails closed when the provisioned checkout is dirty', () => {
    const { base, shas, staging } = immutableCheckoutFixture({ commits: [{}] });

    assert.equal(runCheckoutScript(provisionScript, [staging, shas[0]]).status, 0);
    writeFileSync(join(base, `app-${shas[0]}`, 'tampered.txt'), 'x\n');

    const retry = runCheckoutScript(provisionScript, [staging, shas[0]]);

    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /checkout is dirty/);
  });

  it('installs dependencies only when the toolchain is absent', () => {
    const { shas, staging, root } = immutableCheckoutFixture({
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

    const installed = runCheckoutScript(provisionScript, [staging, shas[0]], {
      PATH: stubPath,
      PNPM_CALLS_LOG: pnpmLog,
    });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(
      readFileSync(pnpmLog, 'utf8'),
      /install --frozen-lockfile/
    );

    rmSync(pnpmLog, { force: true });
    const cached = runCheckoutScript(provisionScript, [staging, shas[1]], {
      PATH: stubPath,
      PNPM_CALLS_LOG: pnpmLog,
    });
    assert.equal(cached.status, 0, cached.stderr);
    assert.equal(existsSync(pnpmLog), false);
  });

  it('migrates the legacy checkout to the release symlink once', () => {
    const { base, legacy, remote, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}],
    });
    assert.equal(runCheckoutScript(provisionScript, [staging, shas[1]]).status, 0);

    const result = runCheckoutScript(flipScript, [remote, shas[1]]);

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
    const { base, remote, shas, staging } = immutableCheckoutFixture({
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

    assert.equal(runCheckoutScript(provisionScript, [staging, shaA]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaA]).status, 0);
    // Age A past the rapid-redeploy guard.
    execFileSync('touch', ['-t', '202001010000', dirA]);

    refreshStagingEnv();
    assert.equal(runCheckoutScript(provisionScript, [staging, shaB]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaB]).status, 0);
    // B is current, A is previous: both stay.
    assert.equal(existsSync(dirA), true);
    assert.equal(existsSync(dirB), true);

    refreshStagingEnv();
    assert.equal(runCheckoutScript(provisionScript, [staging, shaC]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaC]).status, 0);
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

  it('leaves non-release and unregistered directories alone', () => {
    const { base, remote, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}, {}],
    });
    const [shaA, shaB, shaC] = shas;

    assert.equal(runCheckoutScript(provisionScript, [staging, shaA]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaA]).status, 0);
    // Age A past the rapid-redeploy guard so it retires next flip.
    execFileSync('touch', ['-t', '202001010000', join(base, `app-${shaA}`)]);

    assert.equal(runCheckoutScript(provisionScript, [staging, shaB]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaB]).status, 0);

    // Decoys an operator might plausibly leave in the checkout base.
    const backup = join(base, 'app-backup');
    const unregisteredSha = join(base, `app-${'f'.repeat(40)}`);
    const nonHex = join(base, `app-${'z'.repeat(40)}`);
    for (const decoy of [backup, unregisteredSha, nonHex]) {
      mkdirSync(decoy, { recursive: true });
      writeFileSync(join(decoy, 'sentinel.txt'), 'operator data\n');
      execFileSync('touch', ['-t', '202001010000', decoy]);
    }

    assert.equal(runCheckoutScript(provisionScript, [staging, shaC]).status, 0);
    const flipped = runCheckoutScript(flipScript, [remote, shaC]);

    assert.equal(flipped.status, 0, flipped.stderr);
    // A retires (registered, aged, older than previous)...
    assert.equal(existsSync(join(base, `app-${shaA}`)), false);
    // ...while every decoy survives with its contents.
    for (const decoy of [backup, unregisteredSha, nonHex]) {
      assert.equal(
        readFileSync(join(decoy, 'sentinel.txt'), 'utf8'),
        'operator data\n'
      );
    }
    assert.match(
      flipped.stderr,
      /Skipping unregistered checkout during GC/
    );
    assert.doesNotMatch(flipped.stderr, /app-backup/);
  });

  it('refuses to flip to a missing or mismatched checkout', () => {
    const { remote, shas, staging } = immutableCheckoutFixture({ commits: [{}] });
    assert.equal(runCheckoutScript(provisionScript, [staging, shas[0]]).status, 0);

    const missing = runCheckoutScript(flipScript, [
      remote,
      '0123456789abcdef0123456789abcdef01234567',
    ]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Immutable checkout .* is missing/);
  });
});
