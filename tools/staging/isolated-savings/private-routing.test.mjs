import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePrivateRouting } from './private-routing.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

function generate() {
  const { receipt, inventory, now } = routingFixture();
  return generatePrivateRouting(receipt, inventory, now, 'unprivileged-test');
}

test('renders deterministic standalone unprivileged nginx with verified private destinations', () => {
  const output = generate();
  assert.deepEqual(output, generate());
  assert.match(output.config, /server 172\.23\.0\.4:9999;/);
  assert.match(output.config, /server 172\.23\.0\.3:3000;/);
  assert.deepEqual(
    [...output.config.matchAll(/listen ([^;]+);/g)].map((match) => match[1]),
    ['127.0.0.1:15440']
  );
  assert.match(output.config, /daemon off;/);
  assert.match(output.config, /master_process off;/);
  assert.match(output.config, /pid nginx.pid;/);
  assert.match(output.config, /http \{/);
  assert.doesNotMatch(
    output.config,
    /ssl_certificate|^\s*user\s|include\s|listen 443|listen 80/m
  );
});

test('denies admin, signup and every route outside the exact Auth and REST allowlists', () => {
  const { config } = generate();
  assert.match(config, /location \^~ \/auth\/v1\/admin \{ return 403; \}/);
  assert.match(config, /location = \/auth\/v1\/signup \{ return 403; \}/);
  assert.match(config, /location \/ \{ return 404; \}/);
  assert.match(
    config,
    /if \(\$host != staging-auth\.ogabassey\.com\) \{ return 444; \}/
  );
  const proxied = [
    ...config.matchAll(
      /location = ([^ ]+) \{\n {4}if \(\$request_method !~ \^\(([^)]+)\)\$\) \{ return 405; \}\n {4}proxy_pass http:\/\/([^;]+);/g
    ),
  ];
  assert.deepEqual(
    proxied.map((match) => match.slice(1)),
    [
      ['/auth/v1/otp', 'POST', 'baci_private_auth/otp'],
      ['/auth/v1/verify', 'POST', 'baci_private_auth/verify'],
      ['/auth/v1/token', 'POST', 'baci_private_auth/token'],
      ['/auth/v1/logout', 'POST', 'baci_private_auth/logout'],
      ['/auth/v1/user', 'GET|PUT', 'baci_private_auth/user'],
      [
        '/rest/v1/synthetic_goals',
        'GET|HEAD',
        'baci_private_rest/synthetic_goals',
      ],
    ]
  );
  assert.equal((config.match(/proxy_pass http/g) ?? []).length, proxied.length);
});

test('disables payload logs, buffering, retry and untrusted forwarded headers', () => {
  const { config } = generate();
  for (const directive of [
    'access_log off;',
    'error_log /dev/null emerg;',
    'client_max_body_size 64k;',
    'client_body_timeout 10s;',
    'proxy_connect_timeout 2s;',
    'proxy_read_timeout 15s;',
    'proxy_request_buffering off;',
    'proxy_buffering off;',
    'proxy_max_temp_file_size 0;',
    'proxy_next_upstream off;',
    'proxy_pass_request_headers off;',
    'proxy_set_header X-Forwarded-For $remote_addr;',
    'proxy_set_header X-Forwarded-Proto https;',
  ])
    assert.ok(config.includes(directive));
  assert.doesNotMatch(
    config,
    /\$proxy_add_x_forwarded_for|\$http_forwarded|\$http_x_forwarded|\$http_cookie|\$request_body|\$request_uri|resolver /
  );
});

test('receipt binds exact IDs, evidence and config hashes and states regeneration boundary', () => {
  const output = generate();
  assert.deepEqual(output.receipt.containerIds, {
    auth: '3'.repeat(64),
    rest: '4'.repeat(64),
  });
  assert.equal(output.receipt.expiresAt, '2026-09-14T09:05:00.000Z');
  assert.equal(output.receipt.deploymentStatus, 'not-deployed');
  assert.equal(output.receipt.requiresRegenerationAfterRecreation, true);
  assert.match(output.receipt.configSha256, /^[a-f0-9]{64}$/);
  const fixture = routingFixture();
  fixture.receipt.restRoutes[0].methods = ['POST'];
  const changed = generatePrivateRouting(
    fixture.receipt,
    fixture.inventory,
    fixture.now,
    'unprivileged-test'
  );
  assert.notEqual(output.receipt.configSha256, changed.receipt.configSha256);
  assert.notEqual(
    output.receipt.evidenceSha256,
    changed.receipt.evidenceSha256
  );
});

test('no public mode, implicit mode or invalid evidence can generate routing', () => {
  const fixture = routingFixture();
  for (const mode of [undefined, 'public-tls', 'deploy']) {
    assert.throws(() =>
      generatePrivateRouting(
        fixture.receipt,
        fixture.inventory,
        fixture.now,
        mode
      )
    );
  }
  fixture.receipt.containers.auth.id = 'a'.repeat(64);
  assert.throws(() =>
    generatePrivateRouting(
      fixture.receipt,
      fixture.inventory,
      fixture.now,
      'unprivileged-test'
    )
  );
});
