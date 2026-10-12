import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildPrimaryCardAbandonmentPackage } from './primary-wallet-card-checkout-abandonment-package.mjs';

test('builds reviewed standalone worker and nonactivated scheduler with stable byte evidence', async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), 'primary-card-abandonment-package-test-')
  );
  const output = path.join(root, 'package');
  const manifest = await buildPrimaryCardAbandonmentPackage(output);
  assert.equal(manifest.activated, false);
  assert.equal(manifest.cadence, 'hourly');
  assert.equal(manifest.financialTransportIncluded, false);
  for (const [filename, hash] of Object.entries(manifest.outputSha256)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(output, filename)))
        .digest('hex'),
      hash
    );
  }
  const service = await readFile(
    path.join(output, 'baci-primary-card-abandonment.service'),
    'utf8'
  );
  assert.match(service, /ExecStartPre=.*--readiness/);
  assert.match(service, /User=baci-primary-card-abandonment/);
  assert.match(service, /EnvironmentFile=.*abandonment\.env/);
  assert.doesNotMatch(service, /ssh|curl|enable --now/);
  const timer = await readFile(
    path.join(output, 'baci-primary-card-abandonment.timer'),
    'utf8'
  );
  assert.match(timer, /OnUnitInactiveSec=1h/);
  assert.doesNotMatch(timer, /WantedBy.*multi-user/);
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [path.join(output, 'abandonment.cjs'), '--once'],
        { env: {}, encoding: 'utf8', stdio: 'pipe' }
      ),
    (error) => {
      assert.match(error.stderr, /worker unavailable/);
      assert.doesNotMatch(error.stderr, /password|mock|postgres/);
      return true;
    }
  );
  await assert.rejects(buildPrimaryCardAbandonmentPackage(output));
  const rebuilt = await buildPrimaryCardAbandonmentPackage(
    path.join(root, 'repeat')
  );
  assert.deepEqual(rebuilt.outputSha256, manifest.outputSha256);
  assert.deepEqual(rebuilt.sourceClosureSha256, manifest.sourceClosureSha256);
});
test('refuses package output in the source tree', async () => {
  await assert.rejects(
    buildPrimaryCardAbandonmentPackage(process.cwd()),
    /outside/
  );
});
