import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

describe('smoke gigl worker capability', () => {
  it('invokes the VPS capability wrapper with the worker profile', () => {
    const script = readFileSync(
      join(directory, 'smoke-gigl-worker-capability.sh'),
      'utf8'
    );

    assert.match(
      script,
      /remote_dir="\$\{VPS_WORKER_REMOTE_DIR:-\/home\/bassey\/baci-workers\}"/
    );
    assert.match(
      script,
      /BACI_WORKER_PROFILE=gigl-tracking BACI_WORKER_ENV="\$remote_dir\/\.env" "\$remote_dir\/bin\/verify-gigl-tracking-worker-capability\.sh"/
    );
  });
});
