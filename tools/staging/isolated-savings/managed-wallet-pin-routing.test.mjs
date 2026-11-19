import assert from 'node:assert/strict';
import test from 'node:test';
import { generateManagedGateway } from './managed-gateway.mjs';
import { generateManagedPublicIngress } from './managed-public-ingress.mjs';
import { managedRouteContract } from './managed-route-contract.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

test('PIN contract uses the existing private and public generators with exact methods and auth boundaries', () => {
  const input = routingFixture();
  input.receipt.restRoutes = managedRouteContract('hosted-wallet-pin');
  const { host, containers, networks, restRoutes } = input.receipt;
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: input.receipt.verifiedAt,
    leaseNotBefore: input.receipt.verifiedAt,
    leaseExpiresAt: new Date(input.now + 120000).toISOString(),
  };
  const privateOutput = generateManagedGateway(
    binding,
    input.inventory,
    input.now
  );
  const publicOutput = generateManagedPublicIngress(
    binding,
    input,
    input.now,
    true
  );
  for (const route of restRoutes.slice(-5)) {
    assert.ok(
      privateOutput.config.includes(
        'location = ' +
          route.path +
          ' {\n    if ($request_method !~ ^(POST)$) { return 405; }'
      )
    );
    assert.ok(publicOutput.config.includes(`location = ${route.path} {`));
  }
  for (const config of [privateOutput.config, publicOutput.config]) {
    assert.ok(
      config.includes('proxy_set_header Authorization $http_authorization;')
    );
    assert.ok(config.includes('location ^~ /auth/v1/admin { return 403; }'));
    assert.ok(config.includes('location = /auth/v1/signup { return 403; }'));
    assert.ok(config.includes('location / { return 404; }'));
  }
  assert.ok(publicOutput.config.includes('proxy_set_header Cookie "";'));
  assert.ok(
    publicOutput.config.includes(
      'proxy_pass http://unix:/run/baci-savings-gateway/ingress.sock;'
    )
  );
  assert.ok(
    publicOutput.config.includes(
      'if ($request_method !~ "^(POST|OPTIONS)$") { return 405; }'
    )
  );
  assert.ok(!publicOutput.config.includes('127.0.0.1:15440'));
  assert.equal(publicOutput.receipt.expiresAt, binding.leaseExpiresAt);
  assert.ok(
    generateManagedPublicIngress(binding, input, input.now).config.includes(
      'set $baci_public_enabled 0;'
    )
  );
});
