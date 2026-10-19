import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeTemplate } from './compose.mjs';

const script = fileURLToPath(
  new URL('./install-private-firewall.sh', import.meta.url)
);

test('pins isolated bridge names so firewall rules never select another service', () => {
  const { networks } = composeTemplate();
  assert.equal(
    networks.database.driver_opts['com.docker.network.bridge.name'],
    'baci-stg-db'
  );
  assert.equal(
    networks.mail.driver_opts['com.docker.network.bridge.name'],
    'baci-stg-mail'
  );
});

test('admin script is valid shell and scopes rules to new connections on two staging bridges', () => {
  execFileSync('bash', ['-n', script]);
  const source = readFileSync(script, 'utf8');
  assert.match(source, /for bridge in baci-stg-db baci-stg-mail/);
  assert.match(
    source,
    /--ctstate NEW -m comment --comment baci-isolated-savings -j DROP/
  );
  assert.doesNotMatch(source, /Before=docker.service|Requires=docker.service/);
  for (const service of Object.values(composeTemplate().services)) {
    assert.equal(service.restart, 'no');
  }
  assert.match(source, /cmp -s/);
  assert.doesNotMatch(
    source,
    /sudoers|iptables[^\n]* -F|restart docker|restart nginx|reload nginx|chmod 777/
  );
});
