import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    assert.match(script, /mode 600/);
    assert.match(script, /systemctl --user enable/);
    assert.doesNotMatch(script, /sudo|--now/);
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
});
