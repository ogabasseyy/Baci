import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cleanupImmutableCheckoutFixtures,
  immutableCheckoutFixture,
  runCheckoutScript,
} from './immutable-checkout.test-fixtures.mjs';

const libDir = dirname(fileURLToPath(import.meta.url));
const provisionScript = join(libDir, 'provision-immutable-checkout.sh');

afterEach(cleanupImmutableCheckoutFixtures);

describe('immutable checkout duplicate assignments', () => {
  it('provisions under the last BACI_REPO_DIR assignment', () => {
    const { base, shas, staging } = immutableCheckoutFixture({
      commits: [{}],
    });
    // A stale line above the live one: dotenv and the flip use the
    // last assignment, so the provisioner must create the checkout
    // under the live base — a first-match reader would try to fetch
    // from the stale path and fail.
    const envPath = join(staging, '.env');
    writeFileSync(
      envPath,
      `BACI_REPO_DIR=/stale/checkout\n${readFileSync(envPath, 'utf8')}`
    );

    const result = runCheckoutScript(provisionScript, [staging, shas[0]]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), join(base, `app-${shas[0]}`));
    assert.equal(existsSync(join(base, `app-${shas[0]}`)), true);
  });
});
