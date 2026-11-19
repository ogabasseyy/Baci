import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('piggyvest db forwarder deployment files', () => {
  it('keeps the installer out of the automatic worker release', () => {
    assert.equal(
      read('release/worker-release.sh').includes('piggyvest-db-forwarder'),
      false
    );
    assert.equal(
      read('lib/install-worker-services.sh').includes('piggyvest-db-forwarder'),
      false
    );
  });

  it('installs a sandboxed user unit without secrets or env overrides', () => {
    const script = read('install-piggyvest-db-forwarder-service.sh');
    assert.match(script, /baci-piggyvest-db-forwarder\.service/);
    assert.match(script, /jobs\/piggyvest-db-forwarder\.mjs/);
    assert.match(script, /Restart=always/);
    assert.match(script, /NoNewPrivileges=true/);
    assert.match(script, /ProtectSystem=strict/);
    assert.match(script, /ProtectHome=read-only/);
    assert.match(script, /PrivateTmp=true/);
    assert.match(script, /MemoryMax=256M/);
    assert.match(script, /RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6/);
    assert.match(script, /systemctl --user enable/);
    assert.doesNotMatch(script, /network-online|^Wants=|^After=/m);
    assert.doesNotMatch(
      script,
      /EnvironmentFile|PrivateNetwork|IPAddressDeny|sudo|--now/
    );
  });

  it('ships the installer executable', () => {
    const mode = statSync(
      new URL('../install-piggyvest-db-forwarder-service.sh', import.meta.url)
    ).mode;
    assert.notEqual(mode & 0o100, 0);
  });

  it('refuses to install when the workers are not deployed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-dbfwd-install-'));
    const home = mkdtempSync(join(tmpdir(), 'pv-dbfwd-home-'));
    const result = spawnSync(
      'bash',
      [
        new URL('../install-piggyvest-db-forwarder-service.sh', import.meta.url)
          .pathname,
        dir,
      ],
      { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /deploy the workers first/);
  });

  it('documents the owner-run steps', () => {
    const runbook = readFileSync(
      new URL('../../docs/runbooks/piggyvest-db-forwarder.md', import.meta.url),
      'utf8'
    );
    assert.match(runbook, /loginctl enable-linger baci-worker/);
    assert.match(runbook, /15432/);
    assert.match(runbook, /pg-relay\.usebaci\.com/);
    assert.match(runbook, /DNS only/i);
    assert.match(runbook, /systemctl --user show -p MemoryMax/);
    assert.match(runbook, /Client requirements/);
    assert.match(runbook, /rejectUnauthorized/);
    assert.match(runbook, /PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME/);
  });
});
