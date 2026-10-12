import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildPrimaryCardTransferPackage } from './primary-wallet-card-transfer-package.mjs';

test('builds reviewed standalone worker and nonactivated scheduler with stable byte evidence', async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), 'primary-card-transfer-package-test-')
  );
  const output = path.join(root, 'package');
  const manifest = await buildPrimaryCardTransferPackage(output);
  assert.equal(manifest.activated, false);
  assert.equal(manifest.deadline, 'trusted-runtime-and-database-only');
  for (const [filename, hash] of Object.entries(manifest.outputSha256)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(output, filename)))
        .digest('hex'),
      hash
    );
  }
  const service = await readFile(
    path.join(output, 'baci-primary-card-transfer@.service'),
    'utf8'
  );
  assert.match(service, /ExecStartPre=.*--readiness/);
  assert.match(service, /User=baci-primary-card-transfer/);
  assert.match(service, /EnvironmentFile=.*%i.env/);
  assert.doesNotMatch(service, /ssh|curl|enable --now|2026-09/);
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [path.join(output, 'transfer.cjs'), '--once'],
        { env: {}, encoding: 'utf8', stdio: 'pipe' }
      ),
    (error) => {
      assert.match(error.stderr, /worker unavailable/);
      assert.doesNotMatch(error.stderr, /password|mock|postgres/);
      return true;
    }
  );
  await assert.rejects(buildPrimaryCardTransferPackage(output));
  const rebuilt = await buildPrimaryCardTransferPackage(
    path.join(root, 'repeat')
  );
  assert.deepEqual(rebuilt.outputSha256, manifest.outputSha256);
  assert.deepEqual(rebuilt.sourceClosureSha256, manifest.sourceClosureSha256);
});
test('refuses package output in the source tree', async () => {
  await assert.rejects(
    buildPrimaryCardTransferPackage(process.cwd()),
    /outside/
  );
});
