import { createHash } from 'node:crypto';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createRateLimiter } from '../../../tools/connector-gateway/rate-limit';
/** Stable canonical identities, not rotating bearer strings. Process-local request throttling. */
export function createBuilderThrottle(limits: {
  perUser: number;
  perConnection: number;
}) {
  const user = createRateLimiter({
    windowMs: 60000,
    maxPerKey: limits.perUser,
    maxPerIp: Number.MAX_SAFE_INTEGER,
  });
  const connection = createRateLimiter({
    windowMs: 60000,
    maxPerKey: limits.perConnection,
    maxPerIp: Number.MAX_SAFE_INTEGER,
  });
  const key = (id: string) => createHash('sha256').update(id).digest('hex');
  return (identity: BuilderIdentity) =>
    user.check({ ip: 'gateway', keyId: key(identity.actorUserId) }).allowed &&
    connection.check({ ip: 'gateway', keyId: key(identity.connectionId) })
      .allowed;
}
