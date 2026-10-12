import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPrimaryPaidInterestInboxPackage } from './primary-wallet-paid-interest-inbox-package.mjs';

test('builds offline executable plan and hardened readiness-gated timer without financial operations', async () => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'baci-interest-inbox-package-test.')
  );
  try {
    const directory = await buildPrimaryPaidInterestInboxPackage(
      path.join(parent, 'package')
    );
    const planned = spawnSync(
      process.execPath,
      [path.join(directory, 'interest-inbox.cjs'), '--plan'],
      { encoding: 'utf8', env: { PATH: process.env.PATH } }
    );
    assert.equal(planned.status, 0, planned.stderr);
    assert.match(planned.stdout, /Plan only: no database\/provider operations/);
    const refused = spawnSync(
      process.execPath,
      [path.join(directory, 'interest-inbox.cjs'), '--once'],
      { encoding: 'utf8', env: { PATH: process.env.PATH } }
    );
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /worker unavailable/);
    const service = await readFile(
      path.join(directory, 'baci-primary-paid-interest.service'),
      'utf8'
    );
    assert.match(service, /ExecStartPre=.*--readiness/);
    assert.match(service, /User=baci-primary-interest-inbox/);
    assert.match(service, /NoNewPrivileges=true/);
    const timer = await readFile(
      path.join(directory, 'baci-primary-paid-interest.timer'),
      'utf8'
    );
    assert.match(timer, /OnUnitInactiveSec=30s/);
    const manifest = JSON.parse(
      await readFile(path.join(directory, 'manifest.json'), 'utf8')
    );
    assert.equal(Object.keys(manifest.migrations).length, 6);
    assert.ok(
      Object.keys(manifest.sources).some((filename) =>
        filename.endsWith('primary-wallet-paid-interest-inbox-worker.ts')
      )
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
test('rejects package output inside the worktree', async () => {
  await assert.rejects(
    buildPrimaryPaidInterestInboxPackage(
      path.resolve('owned-inbox-package-output')
    ),
    /outside repository/
  );
});
