import { createHash } from 'node:crypto';
import { generatePrivateRouting } from './private-routing.mjs';

const host = 'staging-auth.ogabassey.com';
const origin = 'https://staging.ogabassey.com';
const requestHeaders = [
  'authorization',
  'apikey',
  'content-type',
  'accept',
  'prefer',
  'range',
  'range-unit',
  'x-client-info',
  'x-supabase-api-version',
];

function headers(methods = []) {
  return `    add_header Access-Control-Allow-Origin "${origin}" always;
    add_header Vary "Origin, Access-Control-Request-Method, Access-Control-Request-Headers" always;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Access-Control-Expose-Headers "Content-Range, Range-Unit, Retry-After" always;
${
  methods.length
    ? `    add_header Access-Control-Allow-Methods "${methods.join(', ')}" always;
    add_header Access-Control-Allow-Headers "${requestHeaders.join(', ')}" always;
    add_header Access-Control-Max-Age "0" always;`
    : ''
}`;
}

function location(path, methods) {
  return `  location = ${path} {
${headers(methods)}
    if ($request_method !~ "^(${methods.join('|')}|OPTIONS)$") { return 405; }
    if ($baci_public_preflight ~ "^OPTIONS:(?!(?:${methods.join('|')})$)") { return 405; }
    if ($request_method = OPTIONS) { return 204; }
    proxy_pass http://127.0.0.1:15440;
  }`;
}

function errors() {
  const preserved = [400, 401, 403, 404, 405, 408, 409, 413, 415, 422, 429];
  const unavailable = Array.from(
    { length: 300 },
    (_, index) => index + 300
  ).filter(
    (status) => !preserved.includes(status) && status !== 499 && status !== 444
  );
  return `${preserved.map((status) => `  error_page ${status} =${status} @baci_public_${status};`).join('\n')}
  error_page ${unavailable.join(' ')} =503 @baci_public_503;
${[...preserved, 503]
  .map(
    (status) => `  location @baci_public_${status} {
    default_type application/json;
${headers()}
    return ${status} '{"error":"Request unavailable"}';
  }`
  )
  .join('\n')}`;
}

export function generatePublicIngress(
  receipt,
  inventory,
  now,
  enabled = false
) {
  let privateOutput;
  try {
    if (typeof enabled !== 'boolean') throw new Error();
    privateOutput = generatePrivateRouting(
      receipt,
      inventory,
      now,
      'unprivileged-test'
    );
    if (now >= Date.parse(privateOutput.receipt.expiresAt)) throw new Error();
  } catch {
    throw new Error('Public ingress evidence rejected');
  }
  const authRoutes = [
    { path: '/auth/v1/otp', methods: ['POST'] },
    { path: '/auth/v1/verify', methods: ['POST'] },
    { path: '/auth/v1/token', methods: ['POST'] },
    { path: '/auth/v1/logout', methods: ['POST'] },
    { path: '/auth/v1/user', methods: ['GET', 'PUT'] },
  ];
  const routes = [...authRoutes, ...receipt.restRoutes];
  const allowedHeader = `(?:${requestHeaders.join('|')})`;
  const headerPattern = String.raw`^(?:[ \t]*${allowedHeader}(?:[ \t]*,[ \t]*${allowedHeader})*[ \t]*)?$`;
  const config = `server {
  listen 443 ssl;
  server_name ${host};
  ssl_certificate /etc/letsencrypt/live/${host}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_tickets off;
  access_log off;
  error_log /dev/null emerg;
  server_tokens off;
  set $baci_public_enabled ${enabled ? 1 : 0};
  set $baci_public_preflight "$request_method:$http_access_control_request_method";
  set $baci_public_origin_check "$request_method:$http_origin";
  if ($host != ${host}) { return 444; }
  if ($ssl_server_name != ${host}) { return 444; }
  if ($baci_public_origin_check !~ "^(?:(?!OPTIONS:)[A-Z]+:|[A-Z]+:https://staging[.]ogabassey[.]com)$") { return 403; }
  if ($http_access_control_request_headers !~* "${headerPattern}") { return 403; }
  if ($baci_public_enabled = 0) { return 503; }
${headers()}
  client_max_body_size 64k;
  client_body_buffer_size 64k;
  client_body_in_file_only off;
  client_body_timeout 10s;
  client_header_timeout 10s;
  keepalive_timeout 10s;
  send_timeout 15s;
  proxy_connect_timeout 2s;
  proxy_send_timeout 10s;
  proxy_read_timeout 15s;
  proxy_next_upstream off;
  proxy_http_version 1.1;
  proxy_request_buffering off;
  proxy_buffering off;
  proxy_max_temp_file_size 0;
  proxy_cache off;
  proxy_store off;
  proxy_redirect off;
  proxy_intercept_errors on;
  recursive_error_pages off;
  proxy_ignore_headers X-Accel-Redirect X-Accel-Buffering;
  proxy_pass_request_headers off;
  proxy_set_header Host ${host};
  proxy_set_header X-Forwarded-Host ${host};
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Port 443;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Connection "";
  proxy_set_header Cookie "";
  proxy_set_header Authorization $http_authorization;
  proxy_set_header apikey $http_apikey;
  proxy_set_header Content-Type $http_content_type;
  proxy_set_header Accept $http_accept;
  proxy_set_header Prefer $http_prefer;
  proxy_set_header Range $http_range;
  proxy_set_header Range-Unit $http_range_unit;
${[
  'Set-Cookie',
  'Set-Cookie2',
  'Location',
  'Refresh',
  'X-Powered-By',
  'Cache-Control',
  'Expires',
  'Vary',
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
  'Access-Control-Allow-Private-Network',
]
  .map((name) => `  proxy_hide_header ${name};`)
  .join('\n')}
${errors()}
  location ^~ /auth/v1/admin { return 403; }
  location = /auth/v1/signup { return 403; }
${routes.map((route) => location(route.path, route.methods)).join('\n')}
  location / { return 404; }
}
`;
  return {
    config,
    receipt: {
      version: 1,
      host,
      origin,
      enabled,
      upstream: '127.0.0.1:15440',
      expiresAt: privateOutput.receipt.expiresAt,
      privateConfigSha256: privateOutput.receipt.configSha256,
      evidenceSha256: privateOutput.receipt.evidenceSha256,
      configSha256: createHash('sha256').update(config).digest('hex'),
      deploymentStatus: 'not-deployed',
      requiresSupervisedPrivateListener: true,
      requiresRegenerationAfterRecreation: true,
    },
  };
}
