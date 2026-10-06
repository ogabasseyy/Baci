import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareManagedNginxActivation } from './managed-nginx-activation.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

const liveCandidate = [
  'server {',
  '  listen 443 ssl;',
  '  server_name staging-auth.ogabassey.com;',
  '  location /auth/v1/ {',
  '    rewrite ^/auth/v1/(.*) /$1 break;',
  '    proxy_pass http://172.23.0.3:9999;',
  '  }',
  '  location / {',
  '    proxy_pass http://172.23.0.3:9999;',
  '  }',
  '',
  '    location = /piggyvest/intake {',
  '        client_max_body_size 1m;',
  '        proxy_pass http://127.0.0.1:4791;',
  '        proxy_http_version 1.1;',
  '        proxy_set_header Host $host;',
  '        proxy_read_timeout 12s;',
  '        proxy_send_timeout 12s;',
  '        proxy_request_buffering on;',
  '        proxy_intercept_errors off;',
  '        proxy_next_upstream off;',
  '        proxy_redirect off;',
  '        access_log off;',
  '        error_log /dev/null emerg;',
  '    }',
  '}',
  '',
].join('\n');

function fixture() {
  const input = routingFixture();
  const { host, containers, networks, restRoutes } = input.receipt;
  return {
    input,
    binding: {
      version: 1,
      identity: { host, containers, networks, restRoutes },
      reviewedAt: input.receipt.verifiedAt,
      leaseNotBefore: input.receipt.verifiedAt,
      leaseExpiresAt: new Date(input.now + 60_000).toISOString(),
    },
  };
}

test('replaces only the two general Auth Docker proxies and preserves the exact PiggyVest intake block', () => {
  const { binding, input } = fixture();
  const output = prepareManagedNginxActivation(
    binding,
    input,
    input.now,
    liveCandidate
  );
  const intake = liveCandidate.slice(
    liveCandidate.indexOf('    location = /piggyvest/intake')
  );

  assert.equal(
    output.config.slice(
      output.config.indexOf('    location = /piggyvest/intake')
    ),
    intake
  );
  assert.equal(
    (output.config.match(/proxy_pass http:\/\/172\.23\.0\.3:9999;/g) ?? [])
      .length,
    0
  );
  assert.equal(
    (
      output.config.match(
        /proxy_pass http:\/\/unix:\/run\/baci-savings-gateway\/ingress\.sock;/g
      ) ?? []
    ).length,
    2
  );
  assert.match(output.config, /proxy_pass http:\/\/127\.0\.0\.1:4791;/);
  assert.doesNotMatch(
    output.config,
    /rewrite \^\/auth\/v1\/\(\.\*\) \/\$1 break;/
  );
  assert.match(
    output.config,
    /location \/auth\/v1\/ \{\n {4}proxy_intercept_errors on;\n {4}proxy_next_upstream off;\n {4}error_page 502 504 = @baci_gateway_unavailable;\n {4}proxy_pass http:\/\/unix:\/run\/baci-savings-gateway\/ingress\.sock;/
  );
  assert.match(
    output.config,
    /error_page 502 504 = @baci_gateway_unavailable;/
  );
  assert.match(output.config, /location @baci_gateway_unavailable \{/);
  assert.doesNotMatch(output.config, /error_page 502 503 504/);
  assert.equal(
    (output.config.match(/proxy_next_upstream off;/g) ?? []).length,
    3
  );
  assert.equal(output.leaseExpiresAt, binding.leaseExpiresAt);
});

for (const alter of [
  (value) =>
    value.replace(
      'proxy_pass http://127.0.0.1:4791;',
      'proxy_pass http://unix:/run/baci-savings-gateway/ingress.sock;'
    ),
  (value) =>
    value.replace('location = /piggyvest/intake', 'location /piggyvest/intake'),
  (value) =>
    value.replace(
      'proxy_pass http://172.23.0.3:9999;',
      'proxy_pass http://172.23.0.4:9999;'
    ),
  (value) => value.replace('proxy_pass http://172.23.0.3:9999;', ''),
  (value) =>
    value.replace(
      'rewrite ^/auth/v1/(.*) /$1 break;',
      'rewrite ^/auth/v1/(.*) /auth/v1/$1 break;'
    ),
]) {
  test('fails closed when the observed Nginx layout could alter or lose PiggyVest intake', () => {
    const { binding, input } = fixture();
    assert.throws(() =>
      prepareManagedNginxActivation(
        binding,
        input,
        input.now,
        alter(liveCandidate)
      )
    );
  });
}

test('rejects stale or mismatched evidence before accepting Nginx input', () => {
  const { binding, input } = fixture();
  input.receipt.verifiedAt = new Date(input.now - 300_000).toISOString();
  assert.throws(() =>
    prepareManagedNginxActivation(binding, input, input.now, liveCandidate)
  );
});
