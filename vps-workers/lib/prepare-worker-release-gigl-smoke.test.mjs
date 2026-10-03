import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

describe('prepare worker release GIGL capability smoke', () => {
  it('defers to the post-migration smoke when the wrapper RPCs predate the migration', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(
      script,
      /verify-gigl-tracking-worker-capability\.sh'" \|\| gigl_capability_status=\$\?/
    );
    assert.match(
      script,
      /if \[ "\$gigl_capability_status" -eq 42 \]; then/
    );
    assert.match(script, /deferring capability verification/);
  });

  it('still blocks promotion when capability verification genuinely fails', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(
      script,
      /elif \[ "\$gigl_capability_status" -ne 0 \]; then/
    );
    assert.match(
      script,
      /GIGL database capability verification failed; live worker files and crontab were not changed/
    );
  });
});
