import type { NextRequest } from 'next/server';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { shippingQuoteReadProofSchema } from '@/schemas/storefront-shipping-quote';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';
export const quoteReadCookieName = (merchantId: string) =>
  `baci_quote_read_${merchantId.replaceAll('-', '')}`;
/** Read-only, five-minute continuation. Never authorizes price writes or orders. */
export function createQuoteReadCapability(
  merchantId: string,
  sessionId: string
) {
  return Buffer.from(
    JSON.stringify(
      createShippingQuoteRouteProof({
        action: 'read_storefront_shipping_quotes',
        merchantId,
        subjectId: randomUUID(),
        payload: { merchant_id: merchantId, session_id: sessionId },
      })
    )
  ).toString('base64url');
}
export function parseQuoteReadCapability(token: string | undefined) {
  if (!token || token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token))
    return null;
  try {
    const result = shippingQuoteReadProofSchema.safeParse(
      JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function readQuoteRequestCapability(
  request: NextRequest,
  merchantId: string | undefined
) {
  return (
    request.headers.get('x-baci-quote-read-token') ??
    (merchantId
      ? request.cookies?.get(quoteReadCookieName(merchantId))?.value
      : undefined)
  );
}
