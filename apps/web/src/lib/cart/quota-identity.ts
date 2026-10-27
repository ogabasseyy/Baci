import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';
import type { NextRequest } from 'next/server';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { hashSubject } from './request-quota';

/**
 * Quota identity for anonymous cart operations.
 *
 * When the client presents a well-formed client credential, budgets
 * key on a hash of it: shoppers behind shared egress (carrier NAT,
 * corporate proxies, Cloudflare) hold independent budgets, and one
 * shopper keeps one budget as their network address changes. The
 * credential is a quota key only — it never authenticates anything;
 * cart access stays on server-issued proofs and grants.
 *
 * Clients without a credential (older app versions) keep the legacy
 * trusted network identity, so this is fully backward compatible.
 */
export function getCartQuotaClientIdentity(request: NextRequest): string {
  const credential = request.headers.get(CART_CLIENT_CREDENTIAL_HEADER);
  if (isValidCartClientCredential(credential)) {
    return `client-credential:${hashSubject(credential)}`;
  }
  return getTrustedClientIdentifier(request);
}
