import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

describe('prepare worker release checkout identity', () => {
  it('records the exact application SHA in the promoted worker release', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(
      script,
      /printf '%s' '\$APP_SHA' > '\$STAGING_DIR\/app-checkout\.sha'/
    );
  });

  it('preserves the capability-smoke latch across worker promotes', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(script, /--exclude='\.gigl-capability-smoke-ok'/);
  });
});
