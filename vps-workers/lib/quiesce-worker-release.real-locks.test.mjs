import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  runDriver,
  setup,
  writeExecutable,
} from './quiesce-worker-release.test-fixtures.mjs';

test('quiesce inherits real lock descriptors and holds every lock until shell exit', {
  skip: process.platform !== 'linux' && 'requires Linux util-linux flock',
}, () => {
  const fixture = setup();
  try {
    // Keep systemctl/crontab isolated, but exercise the real flock executable.
    rmSync(join(fixture.bin, 'flock'));
    const driver = join(fixture.root, 'real-lock-driver.sh');
    writeExecutable(
      driver,
      `#!/usr/bin/env bash
set -euo pipefail
. "$QUIESCE_LIB"
quiesce_worker_release "$TEST_REMOTE" || exit 3
for name in aaa.lock zzz.lock mmm.lock error-remediator-global.lock; do
  if flock -n "$TEST_REMOTE/locks/$name" true; then
    echo "lock was not retained: $name" >&2
    exit 4
  fi
done
echo QUIESCE-OK
`
    );
    const result = runDriver(
      fixture,
      {
        QUIESCE_LIB: new URL('./quiesce-worker-release.sh', import.meta.url)
          .pathname,
        TEST_REMOTE: fixture.remote,
      },
      driver
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /QUIESCE-OK/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
