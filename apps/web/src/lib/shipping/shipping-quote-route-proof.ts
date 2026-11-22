import 'server-only';

import { createHmac } from 'node:crypto';
import { getSupabaseServiceRoleKey } from '@/env';

/**
 * Proof minted by the server immediately after it receives a provider quote.
 * The signer and database verifier prefer a dedicated key. Deployments without
 * that key continue to use their existing key while they migrate.
 */
export interface ShippingQuoteRouteProof {
  action: string;
  issued_at: string;
  merchant_id: string;
  payload_text: string;
  proof_id: string;
  signature: string;
  subject_id: string;
  version: 'baci-shipping-quote-proof:v1';
}

const VERSION = 'baci-shipping-quote-proof:v1' as const;
const DOMAIN = 'baci:shipping-quote-rpc:v1';

function secret(): string {
  try {
    const value =
      process.env.BACI_SHIPPING_QUOTE_ROUTE_HMAC?.trim() ||
      getSupabaseServiceRoleKey().trim();
    if (!value) throw new Error('empty quote signing key');
    return value;
  } catch {
    throw new Error('missing_shipping_quote_rpc_server_secret');
  }
}

export function createShippingQuoteRouteProof({
  action,
  merchantId,
  payload,
  subjectId,
  now = new Date().toISOString(),
}: {
  action: string;
  merchantId: string;
  payload: Record<string, unknown>;
  subjectId: string;
  now?: string;
}): ShippingQuoteRouteProof {
  const payloadText = JSON.stringify(payload);
  if (!payloadText) throw new Error('invalid_shipping_quote_proof_payload');
  const canonicalSignature = [
    DOMAIN,
    VERSION,
    action,
    subjectId,
    merchantId,
    now,
    payloadText,
  ].join('\n');
  const signature = createHmac('sha256', secret())
    .update(canonicalSignature)
    .digest('hex');
  return {
    action,
    issued_at: now,
    merchant_id: merchantId,
    payload_text: payloadText,
    proof_id: signature.slice(0, 24),
    signature,
    subject_id: subjectId,
    version: VERSION,
  };
}
