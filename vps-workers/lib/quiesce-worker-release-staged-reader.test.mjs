import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  lockExists,
  runDriver,
  setup,
  writeReaderDriver,
} from './quiesce-worker-release.test-fixtures.mjs';

// Split from quiesce-worker-release.test.mjs (near the 300-line
// limit): staged dotenv-reader coverage for first rollouts.

const directory = dirname(fileURLToPath(import.meta.url));

describe('quiesce staged dotenv reader', () => {
  it('resolves a custom global lock via the staged reader on first rollout', () => {
    const fixture = setup();
    // First rollout: live bin/ has no dotenv reader yet (quiesce runs
    // before the rsync) but .env configures an outside-locks/ path.
    // Without the staged reader the default would be held and a
    // directly launched remediator on the real path would run
    // mid-promote.
    const customDir = join(fixture.root, 'custom');
    mkdirSync(customDir, { recursive: true });
    const customPath = join(customDir, 'remediation.lock');
    mkdirSync(join(fixture.root, 'staging', 'bin'), { recursive: true });
    writeFileSync(
      join(fixture.root, 'staging', 'bin', 'gigl-dotenv.sh'),
      readFileSync(
        join(directory, '..', '..', '.github', 'scripts', 'gigl-dotenv.sh'),
        'utf8'
      )
    );
    writeFileSync(
      join(fixture.remote, '.env'),
      `BACI_REMEDIATION_GLOBAL_LOCK_PATH=${customPath}\n`
    );
    // The transition writes the absolute path into the entries.
    writeFileSync(
      fixture.crontabFixture,
      [
        `* * * * * flock -n ${customPath} true`,
        '* * * * * flock -n $REMOTE_DIR/locks/aaa.lock true',
        '*/5 * * * * flock -n $REMOTE_DIR/locks/gigl-tracking.lock true',
        '* * * * * flock -n $REMOTE_DIR/locks/zzz.lock true',
        '',
      ].join('\n')
    );
    const result = runDriver(
      fixture,
      {},
      writeReaderDriver(
        fixture,
        join(fixture.root, 'staging', 'bin', 'gigl-dotenv.sh')
      )
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /QUIESCE-OK/);
    // Without the staged reader the default would be held and this
    // file never created — the distinguishing outcome.
    assert.ok(existsSync(customPath));
    assert.ok(!lockExists(fixture, 'remediation.lock'));
  });
});
