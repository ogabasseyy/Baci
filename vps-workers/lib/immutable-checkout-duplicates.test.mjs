import assert from 'node:assert/strict';
import { existsSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
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
const flipScript = join(libDir, 'flip-immutable-checkout.sh');

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

  // Every spelling the dotenv-grounded preflight accepts must resolve
  // here too: a strict ^KEY= reader would abort deployments the
  // preflight validated.
  it('provisions with an export-prefixed BACI_REPO_DIR', () => {
    const { base, legacy, shas, staging } = immutableCheckoutFixture({
      commits: [{}],
    });
    writeFileSync(join(staging, '.env'), `export BACI_REPO_DIR=${legacy}\n`);

    const result = runCheckoutScript(provisionScript, [staging, shas[0]]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(base, `app-${shas[0]}`)), true);
  });

  it('provisions with a colon-separated BACI_REPO_DIR', () => {
    const { base, legacy, shas, staging } = immutableCheckoutFixture({
      commits: [{}],
    });
    writeFileSync(join(staging, '.env'), `BACI_REPO_DIR: ${legacy}\n`);

    const result = runCheckoutScript(provisionScript, [staging, shas[0]]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(base, `app-${shas[0]}`)), true);
  });

  it('provisions with spaces and a comment around BACI_REPO_DIR', () => {
    const { base, legacy, shas, staging } = immutableCheckoutFixture({
      commits: [{}],
    });
    writeFileSync(
      join(staging, '.env'),
      `  BACI_REPO_DIR = "${legacy}" # live base\n`
    );

    const result = runCheckoutScript(provisionScript, [staging, shas[0]]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(base, `app-${shas[0]}`)), true);
  });

  it('flips with an export-prefixed BACI_REPO_DIR', () => {
    const { base, legacy, remote, shas, staging } = immutableCheckoutFixture({
      commits: [{}],
    });
    assert.equal(
      runCheckoutScript(provisionScript, [staging, shas[0]]).status,
      0
    );
    writeFileSync(join(remote, '.env'), `export BACI_REPO_DIR=${legacy}\n`);

    const result = runCheckoutScript(flipScript, [remote, shas[0]]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readlinkSync(join(base, 'app-live')),
      join(base, `app-${shas[0]}`)
    );
  });
});
