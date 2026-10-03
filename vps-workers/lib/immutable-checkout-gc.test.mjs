import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cleanupImmutableCheckoutFixtures,
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
});
