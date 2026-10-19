import { createHash } from 'node:crypto';
import {
  generateManagedGateway,
  validateManagedStartup,
} from './managed-gateway.mjs';
import { generatePublicIngress } from './public-ingress.mjs';

export function generateManagedPublicIngress(
  binding,
  input,
  now,
  enabled = false
) {
  try {
    validateManagedStartup(binding, input, now);
    const privateOutput = generateManagedGateway(binding, input.inventory, now);
    const original = generatePublicIngress(
      input.receipt,
      input.inventory,
      now,
      enabled
    );
    const config = original.config.replaceAll(
      'proxy_pass http://127.0.0.1:15440;',
      'proxy_pass http://unix:/run/baci-savings-gateway/ingress.sock;'
    );
    if (config === original.config || config.includes('127.0.0.1:15440'))
      throw new Error();
    return {
      config,
      receipt: {
        ...original.receipt,
        upstream: 'unix:/run/baci-savings-gateway/ingress.sock',
        expiresAt: binding.leaseExpiresAt,
        startupEvidenceExpiresAt: original.receipt.expiresAt,
        bindingSha256: createHash('sha256')
          .update(JSON.stringify(binding))
          .digest('hex'),
        configSha256: createHash('sha256').update(config).digest('hex'),
        privateConfigSha256: createHash('sha256')
          .update(privateOutput.config)
          .digest('hex'),
      },
    };
  } catch {
    throw new Error('Managed public ingress rejected');
  }
}
