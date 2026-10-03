import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
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

// Split from immutable-checkout.test.mjs (which sits at the 300-line
// limit): post-flip garbage-collection tolerance lives here.

const libDir = dirname(fileURLToPath(import.meta.url));
const provisionScript = join(libDir, 'provision-immutable-checkout.sh');
const flipScript = join(libDir, 'flip-immutable-checkout.sh');

afterEach(cleanupImmutableCheckoutFixtures);

describe('immutable checkout garbage collection', () => {
  it('still flips when an old checkout cannot be retired', () => {
    const { base, remote, root, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}, {}],
    });
    const [shaA, shaB, shaC] = shas;
    const dirA = join(base, `app-${shaA}`);

    assert.equal(runCheckoutScript(provisionScript, [staging, shaA]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaA]).status, 0);
    // Age A past the rapid-redeploy guard so this flip tries to retire it.
    execFileSync('touch', ['-t', '202001010000', dirA]);
    assert.equal(runCheckoutScript(provisionScript, [staging, shaB]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaB]).status, 0);
    assert.equal(runCheckoutScript(provisionScript, [staging, shaC]).status, 0);

    // Fail ONLY `worktree remove`: every other git call delegates to the
    // real binary, so the flip itself exercises the true code path.
    const stubBin = join(root, 'stub-bin');
    mkdirSync(stubBin, { recursive: true });
    const realGit = execSync('command -v git', { encoding: 'utf8' }).trim();
    const stubPath = join(stubBin, 'git');
    writeFileSync(
      stubPath,
      [
        '#!/usr/bin/env bash',
        'previous=""',
        'for argument in "$@"; do',
        '  if [ "$argument" = "remove" ] && [ "$previous" = "worktree" ]; then',
        '    echo "stub: refusing worktree remove" >&2',
        '    exit 1',
        '  fi',
        '  previous="$argument"',
        'done',
        'exec "$REAL_GIT" "$@"',
        '',
      ].join('\n')
    );
    chmodSync(stubPath, 0o755);

    const flipped = runCheckoutScript(flipScript, [remote, shaC], {
      PATH: `${stubBin}:${process.env.PATH ?? ''}`,
      REAL_GIT: realGit,
    });

    // The flip lands (symlink moved) despite the stuck GC: failing here
    // would make the caller restore the old tree against the new
    // checkout — a mixed release over a cleanup hiccup.
    assert.equal(flipped.status, 0, flipped.stderr);
    assert.match(
      flipped.stderr,
      /WARNING: could not retire old checkout during GC/
    );
    assert.ok(flipped.stderr.includes(dirA));
    // The residue stays for the next flip (or manual removal); the live
    // releases are untouched.
    assert.equal(existsSync(dirA), true);
    assert.equal(existsSync(join(base, `app-${shaB}`)), true);
    assert.equal(existsSync(join(base, `app-${shaC}`)), true);
  });

  it('reverses the one-time migration from a snapshot', () => {
    const { base, legacy, remote, root, shas, staging } =
      immutableCheckoutFixture({ commits: [{}, {}] });
    const live = join(base, 'app-live');
    // Mirror promote's pre-flip pointer snapshot: legacy layout has no
    // symlink yet.
    const snapshot = join(root, 'snapshot');
    mkdirSync(snapshot, { recursive: true });
    const originalEnv = readFileSync(join(remote, '.env'), 'utf8');
    assert.ok(originalEnv.includes(legacy));
    writeFileSync(join(snapshot, '.env'), originalEnv);
    writeFileSync(join(snapshot, 'app-live-target'), 'NOSYMLINK\n');

    assert.equal(
      runCheckoutScript(provisionScript, [staging, shas[1]]).status,
      0
    );
    assert.equal(runCheckoutScript(flipScript, [remote, shas[1]]).status, 0);
    assert.equal(lstatSync(live).isSymbolicLink(), true);

    const restored = runCheckoutScript(flipScript, [
      '--restore-pointer',
      remote,
      snapshot,
    ]);

    assert.equal(restored.status, 0, restored.stderr);
    // .env names the legacy dir again; the created symlink is gone
    // (guarded -L: a real directory would never be deleted); the
    // legacy clone itself is untouched throughout.
    assert.equal(readFileSync(join(remote, '.env'), 'utf8'), originalEnv);
    assert.equal(existsSync(live), false);
    assert.equal(
      git(['rev-parse', '--is-inside-work-tree'], legacy).trim(),
      'true'
    );
  });

  it('re-points a pre-existing symlink to its pre-flip target', () => {
    const { base, remote, root, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}],
    });
    const live = join(base, 'app-live');
    assert.equal(
      runCheckoutScript(provisionScript, [staging, shas[0]]).status,
      0
    );
    assert.equal(runCheckoutScript(flipScript, [remote, shas[0]]).status, 0);
    // Mirror promote's snapshot after a normal-path flip: symlink
    // present, target recorded.
    const snapshot = join(root, 'snapshot');
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(
      join(snapshot, '.env'),
      readFileSync(join(remote, '.env'), 'utf8')
    );
    writeFileSync(join(snapshot, 'app-live-target'), `${readlinkSync(live)}\n`);

    assert.equal(
      runCheckoutScript(provisionScript, [staging, shas[1]]).status,
      0
    );
    assert.equal(runCheckoutScript(flipScript, [remote, shas[1]]).status, 0);
    assert.equal(readlinkSync(live), join(base, `app-${shas[1]}`));

    const restored = runCheckoutScript(flipScript, [
      '--restore-pointer',
      remote,
      snapshot,
    ]);

    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(readlinkSync(live), join(base, `app-${shas[0]}`));
  });

  it('preserves the previous release when its symlink target is relative', () => {
    const { base, remote, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}],
    });
    const [shaA, shaB] = shas;
    const dirA = join(base, `app-${shaA}`);
    const live = join(base, 'app-live');

    assert.equal(runCheckoutScript(provisionScript, [staging, shaA]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaA]).status, 0);
    // A pre-existing checkout link may point at a relative target
    // (app-live -> app-<sha>); readlink returns it verbatim while the
    // GC loop walks absolute paths. The .env still names the absolute
    // LINK path — only the target spelling differs.
    assert.equal(lstatSync(live).isSymbolicLink(), true);
    unlinkSync(live);
    symlinkSync(`app-${shaA}`, live);
    assert.equal(readlinkSync(live), `app-${shaA}`);
    // Age A past the rapid-redeploy guard so the flip to B would
    // retire it without the normalization.
    execFileSync('touch', ['-t', '202001010000', dirA]);
    assert.equal(runCheckoutScript(provisionScript, [staging, shaB]).status, 0);
    const flipped = runCheckoutScript(flipScript, [remote, shaB]);

    assert.equal(flipped.status, 0, flipped.stderr);
    assert.equal(existsSync(dirA), true);
    assert.equal(readlinkSync(live), join(base, `app-${shaB}`));
  });

  it('preserves the previous release when its relative target has dot segments', () => {
    const { base, remote, shas, staging } = immutableCheckoutFixture({
      commits: [{}, {}],
    });
    const [shaA, shaB] = shas;
    const dirA = join(base, `app-${shaA}`);
    const live = join(base, 'app-live');

    assert.equal(runCheckoutScript(provisionScript, [staging, shaA]).status, 0);
    assert.equal(runCheckoutScript(flipScript, [remote, shaA]).status, 0);
    assert.equal(lstatSync(live).isSymbolicLink(), true);
    unlinkSync(live);
    symlinkSync(`stale-dir/../app-${shaA}`, live);
    execFileSync('touch', ['-t', '202001010000', dirA]);
    assert.equal(runCheckoutScript(provisionScript, [staging, shaB]).status, 0);
    const flipped = runCheckoutScript(flipScript, [remote, shaB]);

    assert.equal(flipped.status, 0, flipped.stderr);
    assert.equal(existsSync(dirA), true);
    assert.equal(readlinkSync(live), join(base, `app-${shaB}`));
  });
});
