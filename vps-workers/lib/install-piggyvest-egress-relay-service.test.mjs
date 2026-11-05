import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('piggyvest egress relay deployment files', () => {
  it('keeps the installer out of the automatic worker release', () => {
    assert.equal(
      read('release/worker-release.sh').includes('piggyvest-egress-relay'),
      false
    );
    assert.equal(
      read('lib/install-worker-services.sh').includes('piggyvest-egress-relay'),
      false
    );
  });

  it('installs a user unit that needs the env file and is sandboxed', () => {
    const script = read('install-piggyvest-egress-relay-service.sh');
    assert.match(script, /ConditionPathExists=\$ENV_FILE/);
    assert.match(script, /EnvironmentFile=\$ENV_FILE/);
    assert.match(script, /NoNewPrivileges=true/);
    assert.match(script, /ProtectSystem=strict/);
    assert.match(script, /ProtectHome=read-only/);
    assert.match(script, /PrivateTmp=true/);
    assert.match(script, /MemoryMax=256M/);
    assert.match(script, /RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6/);
    assert.match(script, /mode 600/);
    assert.match(script, /systemctl --user enable/);
    assert.doesNotMatch(script, /sudo|--now/);
  });

  it('documents the owner-run linger step for the user service', () => {
    const runbook = readFileSync(
      new URL('../../docs/runbooks/piggyvest-egress-relay.md', import.meta.url),
      'utf8'
    );
    assert.match(runbook, /loginctl enable-linger baci-worker/);
    assert.match(runbook, /ProtectSystem=strict/);
  });

  it('proxies only /api/v1/ to loopback, never retries, never logs requests', () => {
    const conf = read('config/piggyvest-egress-relay.nginx.conf')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:18910;/);
    assert.match(conf, /proxy_next_upstream off;/);
    assert.match(conf, /access_log off;/);
    assert.match(conf, /location \^~ \/api\/v1\//);
    assert.equal((conf.match(/proxy_pass/g) ?? []).length, 1);
    assert.doesNotMatch(conf, /access_log\s+(?!off)/);
  });

  it('keeps request lines (with query strings) out of the nginx error log', () => {
    const conf = read('config/piggyvest-egress-relay.nginx.conf')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    // Upstream failures log `request: "GET /path?query"` at error level.
    assert.match(conf, /error_log \/dev\/null crit;/);
  });

  for (const [name, line] of [
    ['too short', 'PIGGYVEST_EGRESS_RELAY_SECRET=short'],
    ['missing', 'OTHER=1'],
    ['empty', 'PIGGYVEST_EGRESS_RELAY_SECRET='],
  ]) {
    it(`refuses to install when the relay secret is ${name}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'pv-relay-install-'));
      writeFileSync(join(dir, 'piggyvest-egress-relay.env'), `${line}\n`, {
        mode: 0o600,
      });
      const home = mkdtempSync(join(tmpdir(), 'pv-relay-home-'));
      const result = spawnSync(
        'bash',
        [
          new URL(
            '../install-piggyvest-egress-relay-service.sh',
            import.meta.url
          ).pathname,
          dir,
        ],
        { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' }
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /PIGGYVEST_EGRESS_RELAY_SECRET/);
      assert.doesNotMatch(result.stdout + result.stderr, /=short/);
    });
  }
});
