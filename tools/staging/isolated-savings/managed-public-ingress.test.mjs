import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateManagedPublicIngress } from './managed-public-ingress.mjs';
import { routingFixture } from './private-routing.test-support.mjs';
import { generatePublicIngress } from './public-ingress.mjs';

test('managed public routing substitutes only protected Unix upstream and keeps legacy API unchanged', () => {
  const input = routingFixture();
  const { host, containers, networks, restRoutes } = input.receipt;
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: input.receipt.verifiedAt,
    leaseNotBefore: input.receipt.verifiedAt,
    leaseExpiresAt: new Date(input.now + 3600000).toISOString(),
  };
  const legacy = generatePublicIngress(
    input.receipt,
    input.inventory,
    input.now,
    true
  );
  const managed = generateManagedPublicIngress(binding, input, input.now, true);
  assert.equal(
    managed.config,
    legacy.config.replaceAll(
      'proxy_pass http://127.0.0.1:15440;',
      'proxy_pass http://unix:/run/baci-savings-gateway/ingress.sock;'
    )
  );
  assert.doesNotMatch(
    managed.config,
    /127\.0\.0\.1:15440|proxy_pass http:\/\/[0-9]/
  );
  assert.equal(managed.receipt.expiresAt, binding.leaseExpiresAt);
  assert.equal(
    managed.receipt.startupEvidenceExpiresAt,
    legacy.receipt.expiresAt
  );
  assert.notEqual(managed.receipt.configSha256, legacy.receipt.configSha256);
  assert.match(
    generateManagedPublicIngress(binding, input, input.now).config,
    /set \$baci_public_enabled 0;/
  );
  assert.throws(() =>
    generateManagedPublicIngress(binding, input, input.now + 300001, true)
  );
  binding.identity.host = 'production.invalid';
  assert.throws(() =>
    generateManagedPublicIngress(binding, input, input.now, true)
  );
});

test('unit contains dedicated identity, runtime protection, hard lease bound and whole-cgroup withdrawal', () => {
  const unit = readFileSync(
    new URL('./managed-gateway.service', import.meta.url),
    'utf8'
  );
  for (const value of [
    'User=baci-savings-gateway',
    'Group=baci-savings-ingress',
    'RuntimeDirectory=baci-savings-gateway',
    'RuntimeDirectoryMode=0750',
    'RuntimeDirectoryPreserve=no',
    'UMask=0007',
    'Restart=no',
    'KillMode=control-group',
    'RuntimeMaxSec=24h',
  ])
    assert.ok(unit.includes(value));
  assert.doesNotMatch(
    unit,
    /SupplementaryGroups=docker|User=root|Restart=always|ExecStartPre=|\[Install\]/
  );
});
