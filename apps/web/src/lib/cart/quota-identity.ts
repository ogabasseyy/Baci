import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';
import type { NextRequest } from 'next/server';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import {
  type CartQuotaOperation,
  type CartQuotaResult,
  checkCartQuota,
  hashSubject,
} from './request-quota';

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

export type AnonymousCartQuotaOperation =
  | 'bootstrap'
  | 'create'
  | 'handoff_preview';

const NETWORK_BACKSTOP_OPERATION: Record<
  AnonymousCartQuotaOperation,
  CartQuotaOperation
> = {
  bootstrap: 'bootstrap_network_backstop',
  create: 'create_network_backstop',
  handoff_preview: 'handoff_preview_network_backstop',
};

/**
 * Anonymous quota check with a non-rotatable bound.
 *
 * The credential is client-minted: shape validation cannot stop a
 * script from rotating it per request to mint fresh budgets. So a
 * credential-keyed check is always paired with a network-identity
 * backstop at a multiple of the primary limit (see
 * NETWORK_BACKSTOP_MULTIPLIER): per-shopper fairness comes from the
 * credential budget, while total anonymous volume from one network
 * stays bounded no matter how often the header changes.
 *
 * Without a valid credential this is exactly the legacy behavior:
 * one network-identity check at the primary limit.
 */
export async function checkAnonymousCartQuota(
  request: NextRequest,
  input: { merchantId: string; operation: AnonymousCartQuotaOperation }
): Promise<CartQuotaResult> {
  const credential = request.headers.get(CART_CLIENT_CREDENTIAL_HEADER);
  if (!isValidCartClientCredential(credential)) {
    return checkCartQuota({
      ...input,
      subject: getTrustedClientIdentifier(request),
    });
  }
  const credentialQuota = await checkCartQuota({
    ...input,
    subject: `client-credential:${hashSubject(credential)}`,
  });
  if (!credentialQuota.allowed) return credentialQuota;
  return checkCartQuota({
    merchantId: input.merchantId,
    operation: NETWORK_BACKSTOP_OPERATION[input.operation],
    subject: getTrustedClientIdentifier(request),
  });
}
