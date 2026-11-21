import { createHash, timingSafeEqual } from 'node:crypto';

export type PartnerScope =
  | 'catalog:read'
  | 'quotes:write'
  | 'orders:write'
  | 'orders:read'
  | 'reconciliation:write';

export type PartnerConnection = {
  id: string;
  merchantId: string;
  token: string | undefined;
  scopes: readonly PartnerScope[];
};

type AuthorizationResult =
  | { ok: true; connectionId: string; merchantId: string }
  | {
      ok: false;
      reason: 'unauthorized' | 'unconfigured' | 'ambiguous' | 'scope_required';
    };

// 32 random bytes take 43 characters in unpadded base64url.
const bearerTokenPattern = /^[A-Za-z0-9_-]{43,}$/;

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

export function authorizePartner(
  authorization: string | null,
  connections: readonly PartnerConnection[],
  requiredScope: PartnerScope
): AuthorizationResult {
  const credential = /^Bearer +(.+)$/i.exec(authorization ?? '')?.[1];
  if (!credential || !bearerTokenPattern.test(credential)) {
    return { ok: false, reason: 'unauthorized' };
  }

  const credentialDigest = digest(credential);
  let configured = false;
  let matched: PartnerConnection | undefined;
  for (const connection of connections) {
    const { token } = connection;
    if (!token || !bearerTokenPattern.test(token)) continue;
    configured = true;
    if (!timingSafeEqual(credentialDigest, digest(token))) continue;
    if (matched) return { ok: false, reason: 'ambiguous' };
    matched = connection;
  }

  if (!configured) return { ok: false, reason: 'unconfigured' };
  if (!matched) return { ok: false, reason: 'unauthorized' };
  if (!matched.scopes.includes(requiredScope)) {
    return { ok: false, reason: 'scope_required' };
  }

  return { ok: true, connectionId: matched.id, merchantId: matched.merchantId };
}
