import { createHash } from 'node:crypto';
import { validatePrivateRouting } from './private-routing-inventory.mjs';

function location(path, methods, upstream, target) {
  return `  location = ${path} {
    if ($request_method !~ ^(${methods.join('|')})$) { return 405; }
    proxy_pass http://${upstream}${target};
  }`;
}

export function renderPrivateRoutingConfig(checked, managed = false) {
  const authRoutes = [
    ['otp', ['POST']],
    ['verify', ['POST']],
    ['token', ['POST']],
    ['logout', ['POST']],
    ['user', ['GET', 'PUT']],
  ];
  const locations = authRoutes.map(([path, methods]) =>
    location(`/auth/v1/${path}`, methods, 'baci_private_auth', `/${path}`)
  );
  for (const route of checked.restRoutes) {
    locations.push(
      location(
        route.path,
        route.methods,
        'baci_private_rest',
        route.path.slice('/rest/v1'.length)
      )
    );
  }
  const config = `daemon off;
master_process off;
worker_processes 1;
pid nginx.pid;
error_log /dev/null emerg;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path client-body;
  proxy_temp_path proxy-temp;
  fastcgi_temp_path fastcgi-temp;
  uwsgi_temp_path uwsgi-temp;
  scgi_temp_path scgi-temp;
upstream baci_private_auth { server ${checked.destinations.auth}:9999; }
upstream baci_private_rest { server ${checked.destinations.rest}:3000; }
server {
  listen ${managed ? 'unix:/run/baci-savings-gateway/ingress.sock' : '127.0.0.1:15440'};
  server_name ${checked.host};
  if ($host != ${checked.host}) { return 444; }
  access_log off;
  error_log /dev/null emerg;
  server_tokens off;
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
  proxy_ignore_headers X-Accel-Redirect X-Accel-Buffering;
  proxy_pass_request_headers off;
  proxy_set_header Host ${checked.host};
  proxy_set_header X-Forwarded-Host ${checked.host};
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Port 443;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Connection "";
  proxy_set_header Authorization $http_authorization;
  proxy_set_header apikey $http_apikey;
  proxy_set_header Content-Type $http_content_type;
  proxy_set_header Accept $http_accept;
  proxy_set_header Prefer $http_prefer;
  proxy_set_header Range $http_range;
  proxy_set_header Range-Unit $http_range_unit;
  location ^~ /auth/v1/admin { return 403; }
  location = /auth/v1/signup { return 403; }
${locations.join('\n')}
  location / { return 404; }
}
}
`;
  return config;
}

export function generatePrivateRouting(receipt, inventory, now, mode) {
  if (mode !== 'unprivileged-test')
    throw new Error('Only unprivileged-test routing is supported');
  const checked = validatePrivateRouting(receipt, inventory, now);
  const config = renderPrivateRoutingConfig(checked);
  return {
    config,
    receipt: {
      version: 1,
      mode,
      host: checked.host,
      containerIds: {
        auth: receipt.containers.auth.id,
        rest: receipt.containers.rest.id,
      },
      networkIds: {
        database: receipt.networks.database.id,
        mail: receipt.networks.mail.id,
      },
      expiresAt: checked.expiresAt,
      configSha256: createHash('sha256').update(config).digest('hex'),
      evidenceSha256: createHash('sha256')
        .update(JSON.stringify({ receipt, inventory }))
        .digest('hex'),
      deploymentStatus: 'not-deployed',
      requiresRegenerationAfterRecreation: true,
    },
  };
}
