import assert from 'node:assert/strict';
import test from 'node:test';
import { routingFixture } from './private-routing.test-support.mjs';
import { generatePublicIngress } from './public-ingress.mjs';

function fixture() {
  const input = routingFixture();
  input.receipt.restRoutes = [
    { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/rpc/customer_savings_draft_command', methods: ['POST'] },
  ];
  return input;
}

function generate(enabled) {
  const { receipt, inventory, now } = fixture();
  return generatePublicIngress(receipt, inventory, now, enabled);
}

function routeBlock(config, path) {
  const start = config.indexOf(`  location = ${path} {\n`);
  assert.notEqual(start, -1);
  return config.slice(start, config.indexOf('\n  }', start));
}

test('defaults to disabled and requires a boolean opt-in', () => {
  assert.match(generate().config, /set \$baci_public_enabled 0;/);
  assert.match(
    generate().config,
    /if \(\$baci_public_enabled = 0\) \{ return 503; \}/
  );
  assert.match(generate(true).config, /set \$baci_public_enabled 1;/);
  for (const enabled of ['true', 1, null, {}])
    assert.throws(
      () => generate(enabled),
      /^Error: Public ingress evidence rejected$/
    );
});

test('produces only a shared HTTP-context HTTPS server and fixed loopback proxy', () => {
  const { config } = generate(true);
  assert.deepEqual(
    [...config.matchAll(/listen ([^;]+);/g)].map((match) => match[1]),
    ['443 ssl']
  );
  assert.match(config, /server_name staging-auth\.ogabassey\.com;/);
  assert.match(
    config,
    /if \(\$host != staging-auth\.ogabassey\.com\) \{ return 444; \}/
  );
  assert.match(
    config,
    /if \(\$ssl_server_name != staging-auth\.ogabassey\.com\) \{ return 444; \}/
  );
  assert.deepEqual(
    [
      ...new Set(
        [...config.matchAll(/proxy_pass ([^;]+);/g)].map((match) => match[1])
      ),
    ],
    ['http://127.0.0.1:15440']
  );
  assert.doesNotMatch(
    config,
    /\bupstream |172\.23\.|:9999|:3000|resolver |default_server|daemon |master_process |include |events \{|http \{/
  );
});

test('exposes exactly private Auth paths and receipt REST paths with no broad proxy', () => {
  const { config } = generate(true);
  const paths = [...config.matchAll(/location = ([^ ]+) \{\n/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(paths, [
    '/auth/v1/otp',
    '/auth/v1/verify',
    '/auth/v1/token',
    '/auth/v1/logout',
    '/auth/v1/user',
    '/rest/v1/products',
    '/rest/v1/rpc/customer_savings_draft_command',
  ]);
  assert.match(config, /location \^~ \/auth\/v1\/admin \{ return 403; \}/);
  assert.match(config, /location = \/auth\/v1\/signup \{ return 403; \}/);
  assert.match(config, /location \/ \{ return 404; \}/);
  assert.equal((config.match(/proxy_pass /g) ?? []).length, paths.length);
  const input = fixture();
  input.receipt.restRoutes.pop();
  assert.doesNotMatch(
    generatePublicIngress(input.receipt, input.inventory, input.now, true)
      .config,
    /customer_savings_draft_command/
  );
});

test('strict origin check permits native requests without Origin but requires exact preflight Origin', () => {
  const { config } = generate(true);
  const pattern = config.match(/\$baci_public_origin_check !~ "([^"]+)"/)?.[1];
  assert.ok(pattern);
  const accepted = new RegExp(pattern);
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS']) {
    assert.equal(
      accepted.test(`${method}:https://staging.ogabassey.com`),
      true
    );
    assert.equal(accepted.test(`${method}:`), method !== 'OPTIONS');
    for (const origin of [
      'null',
      'http://staging.ogabassey.com',
      'https://ogabassey.com',
      'https://staging.ogabassey.com.evil.test',
      'https://staging.ogabassey.com https://evil.test',
    ])
      assert.equal(accepted.test(`${method}:${origin}`), false);
  }
  assert.doesNotMatch(
    config,
    /add_header Access-Control-Allow-Origin (?:\*|\$http_origin)|add_header Access-Control-Allow-Credentials/
  );
});

test('emitted method and preflight expressions allow only each routes approved methods', () => {
  const { config } = generate(true);
  for (const [path, approved] of [
    ['/auth/v1/user', ['GET', 'PUT']],
    ['/auth/v1/token', ['POST']],
    ['/rest/v1/products', ['GET', 'HEAD']],
    ['/rest/v1/rpc/customer_savings_draft_command', ['POST']],
  ]) {
    const block = routeBlock(config, path);
    const actual = new RegExp(
      block.match(/\$request_method !~ "([^"]+)"/)?.[1]
    );
    const preflightDenied = new RegExp(
      block.match(/\$baci_public_preflight ~ "([^"]+)"/)?.[1]
    );
    for (const method of [
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'TRACE',
      'CONNECT',
      '',
    ]) {
      assert.equal(
        actual.test(method),
        method === 'OPTIONS' || approved.includes(method),
        `${path} ${method}`
      );
      assert.equal(
        preflightDenied.test(`OPTIONS:${method}`),
        !approved.includes(method),
        `${path} preflight ${method}`
      );
    }
    assert.match(block, /if \(\$request_method = OPTIONS\) \{ return 204; \}/);
    assert.ok(
      block.indexOf('$baci_public_preflight ~') <
        block.indexOf('$request_method = OPTIONS')
    );
    assert.ok(
      block.includes(
        `Access-Control-Allow-Methods "${approved.join(', ')}" always;`
      )
    );
    assert.match(block, /Access-Control-Max-Age "0" always;/);
  }
});

test('preflight headers allow bearer SDK requests but reject cookies and forwarding injection', () => {
  const { config } = generate(true);
  const pattern = config.match(
    /\$http_access_control_request_headers !~\* "([^"]+)"/
  )?.[1];
  assert.ok(pattern);
  const allowed = new RegExp(pattern.replaceAll('\\\\', '\\'), 'i');
  for (const headers of [
    '',
    'authorization, apikey, content-type, x-client-info',
    'Authorization,Range,Range-Unit',
    'x-supabase-api-version',
  ])
    assert.equal(allowed.test(headers), true, headers);
  for (const headers of [
    'cookie',
    'x-forwarded-host',
    'authorization,cookie',
    'authorization,',
    'evil-authorization',
  ])
    assert.equal(allowed.test(headers), false, headers);
});

test('CORS and security headers survive per-location add_header inheritance', () => {
  const { config } = generate(true);
  const block = routeBlock(config, '/rest/v1/products');
  for (const directive of [
    'Access-Control-Allow-Origin "https://staging.ogabassey.com" always;',
    'Vary "Origin, Access-Control-Request-Method, Access-Control-Request-Headers" always;',
    'Cache-Control "no-store" always;',
    'X-Content-Type-Options "nosniff" always;',
  ])
    assert.ok(block.includes(directive), directive);
  assert.match(
    config,
    /Access-Control-Expose-Headers "Content-Range, Range-Unit, Retry-After" always;/
  );
});

test('forwards bearer exactly and drops cookies, spoofed forwarding and upstream CORS', () => {
  const { config } = generate(true);
  for (const directive of [
    'proxy_pass_request_headers off;',
    'proxy_set_header Authorization $http_authorization;',
    'proxy_set_header Cookie "";',
    'proxy_hide_header Set-Cookie;',
    'proxy_hide_header Access-Control-Allow-Origin;',
    'proxy_hide_header Access-Control-Allow-Credentials;',
    'proxy_hide_header Location;',
    'proxy_set_header Host staging-auth.ogabassey.com;',
    'proxy_set_header X-Forwarded-Proto https;',
  ])
    assert.ok(config.includes(directive), directive);
  assert.doesNotMatch(
    config,
    /\$http_cookie|\$proxy_add_x_forwarded_for|\$http_forwarded|\$http_x_forwarded/
  );
});

test('sanitizes error bodies, ignores internal redirects and disables payload persistence', () => {
  const { config } = generate(true);
  for (const directive of [
    'proxy_intercept_errors on;',
    'recursive_error_pages off;',
    'proxy_ignore_headers X-Accel-Redirect X-Accel-Buffering;',
    'access_log off;',
    'error_log /dev/null emerg;',
    'server_tokens off;',
    'proxy_request_buffering off;',
    'proxy_buffering off;',
    'proxy_max_temp_file_size 0;',
    'proxy_cache off;',
    'proxy_store off;',
    'proxy_next_upstream off;',
    'client_max_body_size 64k;',
  ])
    assert.ok(config.includes(directive), directive);
  assert.match(config, /error_page 401 =401 @baci_public_401;/);
  assert.match(config, /error_page 429 =429 @baci_public_429;/);
  assert.match(config, /return 503 '\{"error":"Request unavailable"\}';/);
  assert.doesNotMatch(
    config,
    /\$request_body|\$upstream_|\$args|\$request_uri|proxy_pass_header /
  );
});

test('error mapping excludes nginx client-close 499 and retains host-rejection 444', () => {
  const statuses = [
    ...generate(true).config.matchAll(/error_page ([\d ]+) =/g),
  ].flatMap((match) => match[1].trim().split(/ +/).map(Number));
  assert.equal(statuses.includes(499), false);
  assert.equal(statuses.includes(444), false);
  assert.equal(new Set(statuses).size, 298);
  assert.equal(
    statuses.every((status) => status >= 300 && status <= 599),
    true
  );
});
