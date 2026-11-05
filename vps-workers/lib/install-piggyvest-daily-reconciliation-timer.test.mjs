import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const SCRIPT = new URL(
  '../install-piggyvest-daily-reconciliation-timer.sh',
  import.meta.url
).pathname;

// Builds a fake host (home, release dir, env file, fake systemctl) so the
// installer never touches the real systemd.
const makeHost = () => {
  const root = mkdtempSync(join(tmpdir(), 'pv-recon-install-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const current = join(root, 'current');
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(join(current, 'workers', 'jobs'), { recursive: true });
  writeFileSync(join(current, 'workers', 'jobs', 'run-web-cron.mjs'), '');
  const envFile = join(root, 'worker.env');
  writeFileSync(envFile, 'CRON_SECRET=super-secret-value\n');
  const log = join(root, 'systemctl.log');
  const fake = join(bin, 'systemctl');
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\n`);
  chmodSync(fake, 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home };
  const run = () =>
    spawnSync('bash', [SCRIPT, current, envFile, '/usr/bin/node'], {
      env,
      encoding: 'utf8',
    });
  return {
    run,
    current,
    envFile,
    log,
    dir: join(home, '.config/systemd/user'),
  };
};

describe('piggyvest daily reconciliation timer deployment files', () => {
  it('keeps the installer out of the automatic worker release', () => {
    for (const file of [
      'release/worker-release.sh',
      'lib/install-worker-services.sh',
    ]) {
      assert.equal(
        read(file).includes('piggyvest-daily-reconciliation'),
        false
      );
    }
  });

  it('writes the oneshot service and the 23:00 UTC timer', () => {
    const host = makeHost();
    const result = host.run();
    assert.equal(result.status, 0, result.stderr);
    const service = readFileSync(
      join(host.dir, 'baci-piggyvest-daily-reconciliation.service'),
      'utf8'
    );
    const timer = readFileSync(
      join(host.dir, 'baci-piggyvest-daily-reconciliation.timer'),
      'utf8'
    );
    assert.match(service, /^Type=oneshot$/m);
    assert.match(service, new RegExp(`^EnvironmentFile=${host.envFile}$`, 'm'));
    assert.match(
      service,
      new RegExp(`^WorkingDirectory=${host.current}/workers$`, 'm')
    );
    assert.match(
      service,
      new RegExp(
        `^ExecStart=/usr/bin/node ${host.current}/workers/jobs/run-web-cron\\.mjs /api/cron/piggyvest-daily-reconciliation$`,
        'm'
      )
    );
    assert.match(service, /^TimeoutStartSec=300$/m);
    assert.match(service, /^NoNewPrivileges=true$/m);
    assert.match(service, /^ProtectSystem=strict$/m);
    assert.match(service, /^PrivateTmp=true$/m);
    assert.doesNotMatch(service, /PrivateNetwork|IPAddressDeny/);
    assert.doesNotMatch(service, /CRON_SECRET|super-secret-value|Bearer/);
    assert.match(timer, /^OnCalendar=\*-\*-\* 23:00:00 UTC$/m);
    assert.match(timer, /^Persistent=true$/m);
    assert.match(timer, /^AccuracySec=1min$/m);
    assert.match(timer, /^Unit=baci-piggyvest-daily-reconciliation\.service$/m);
    assert.match(timer, /^WantedBy=timers\.target$/m);
    assert.doesNotMatch(timer, /super-secret-value/);
  });

  it('only reloads and enables its own timer, and re-runs cleanly', () => {
    const host = makeHost();
    assert.equal(host.run().status, 0);
    assert.equal(host.run().status, 0);
    const calls = readFileSync(host.log, 'utf8').trim().split('\n');
    assert.equal(calls[0], '--user daemon-reload');
    assert.equal(
      calls[1],
      '--user enable --now baci-piggyvest-daily-reconciliation.timer'
    );
    for (const call of calls) {
      assert.match(call, /^--user /);
      assert.doesNotMatch(call, /forwarder|egress|restart|stop|disable/);
    }
  });

  it('ships the installer executable', () => {
    assert.notEqual(statSync(SCRIPT).mode & 0o100, 0);
  });

  it('refuses to install when the workers are not deployed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-recon-empty-'));
    const home = mkdtempSync(join(tmpdir(), 'pv-recon-home-'));
    const result = spawnSync('bash', [SCRIPT, dir], {
      env: { PATH: process.env.PATH, HOME: home },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /deploy the workers first/);
  });

  it('documents the owner-run steps', () => {
    const doc = readFileSync(
      new URL('../../docs/piggyvest-daily-reconciliation.md', import.meta.url),
      'utf8'
    );
    assert.match(doc, /install-piggyvest-daily-reconciliation-timer\.sh/);
    assert.match(doc, /list-timers baci-piggyvest-daily-reconciliation\.timer/);
    assert.match(
      doc,
      /journalctl --user -u baci-piggyvest-daily-reconciliation/
    );
    assert.match(
      doc,
      /disable --now baci-piggyvest-daily-reconciliation\.timer/
    );
  });
});
