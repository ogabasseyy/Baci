import { createHash } from 'node:crypto';
import { validateManagedStartup } from './managed-gateway.mjs';

const dockerUpstream = 'proxy_pass http://172.23.0.3:9999;';
const gatewayUpstream =
  'proxy_pass http://unix:/run/baci-savings-gateway/ingress.sock;';
const authRewrite = 'rewrite ^/auth/v1/(.*) /$1 break;';
const authDockerLocation = `location /auth/v1/ {
    ${authRewrite}
    ${dockerUpstream}`;
const authGatewayLocation = `location /auth/v1/ {
    ${gatewayUpstream}`;
const gatewayGuards = `proxy_intercept_errors on;
    proxy_next_upstream off;
    error_page 502 504 = @baci_gateway_unavailable;`;
const unavailableLocation = `  location @baci_gateway_unavailable {
    internal;
    default_type application/json;
    return 503 '{"error":"Request unavailable"}';
  }`;
const intakeLocation = 'location = /piggyvest/intake';
const intakeUpstream = 'proxy_pass http://127.0.0.1:4791;';

function count(value, fragment) {
  return value.split(fragment).length - 1;
}

function intakeBlock(config) {
  const start = config.indexOf(intakeLocation);
  if (start < 0) throw new Error('Managed Nginx activation rejected');
  const end = config.indexOf('\n    }', start);
  if (end < 0) throw new Error('Managed Nginx activation rejected');
  return config.slice(start, end + 6);
}

export function prepareManagedNginxActivation(binding, evidence, now, config) {
  try {
    validateManagedStartup(binding, evidence, now);
    if (typeof config !== 'string' || Buffer.byteLength(config) > 262144)
      throw new Error();
    if (
      count(config, dockerUpstream) !== 2 ||
      count(config, intakeLocation) !== 1 ||
      count(config, authDockerLocation) !== 1
    )
      throw new Error();
    const originalIntake = intakeBlock(config);
    if (
      count(originalIntake, intakeUpstream) !== 1 ||
      originalIntake.includes(gatewayUpstream)
    )
      throw new Error();
    let output = config
      .replace(authDockerLocation, authGatewayLocation)
      .replace(dockerUpstream, gatewayUpstream);
    output = output.replaceAll(
      gatewayUpstream,
      `${gatewayGuards}\n    ${gatewayUpstream}`
    );
    const intakeStart = output.indexOf(`    ${intakeLocation}`);
    if (intakeStart < 0) throw new Error();
    output = `${output.slice(0, intakeStart)}${unavailableLocation}\n${output.slice(intakeStart)}`;
    if (
      count(output, gatewayUpstream) !== 2 ||
      count(output, 'error_page 502 504 = @baci_gateway_unavailable;') !== 2 ||
      intakeBlock(output) !== originalIntake ||
      output.includes(authRewrite)
    )
      throw new Error();
    return {
      config: output,
      configSha256: createHash('sha256').update(output).digest('hex'),
      leaseExpiresAt: binding.leaseExpiresAt,
    };
  } catch {
    throw new Error('Managed Nginx activation rejected');
  }
}
