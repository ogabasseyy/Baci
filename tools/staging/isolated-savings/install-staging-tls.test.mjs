import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const path = new URL('./install-staging-tls.sh', import.meta.url);
const source = readFileSync(path, 'utf8');

test('installer parses and rejects invocation without explicit install', () => {
  assert.equal(spawnSync('bash', ['-n', path.pathname]).status, 0);
  const result = spawnSync('bash', [path.pathname], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Administrator execution/);
});

test('TLS bootstrap is restricted to one hostname with no upstream access', () => {
  const config = source.split("<<'NGINX'\n")[1].split('\nNGINX')[0];
  assert.match(config, /server_name staging-auth\.ogabassey\.com;/);
  assert.match(config, /return 503 .*STAGING_NOT_READY/);
  assert.match(config, /access_log off;/);
  assert.match(config, /Cache-Control "no-store" always;/);
  assert.doesNotMatch(
    config,
    /proxy_pass|fastcgi_pass|\broot\b|\balias\b|\binclude\b/
  );
  assert.match(config, /ssl_protocols TLSv1.2 TLSv1.3;/);
});

test('installer refuses existing files and validates before reload with rollback', () => {
  assert.match(source, /! -e "\$available" && ! -L "\$available"/);
  assert.match(source, /! -e "\$enabled" && ! -L "\$enabled"/);
  assert.match(source, /set -o noclobber/);
  assert.match(source, /trap cleanup EXIT/);
  assert.ok(
    source.lastIndexOf('nginx -t') < source.indexOf('systemctl reload nginx')
  );
  assert.ok(
    source.indexOf('systemctl reload nginx') < source.indexOf('committed=1')
  );
  assert.doesNotMatch(
    source,
    /systemctl (?:stop|restart)|certbot|iptables|docker/
  );
});
