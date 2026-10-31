import { NextResponse } from 'next/server';
import { isUcpSharedCartEnabled } from '@/lib/agentic/is-ucp-shared-cart-enabled';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

/**
 * Fails a UCP cart route closed unless the merchant is enrolled in shared
 * cart. Routes call it before reserving any idempotency key or request ID, so
 * a refused call leaves no reservation or legacy cart row behind (F34).
 */
export async function checkUcpCartAvailability(
  merchantId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  let enabled: boolean;
  try {
    enabled = await isUcpSharedCartEnabled(merchantId);
  } catch (error) {
    logger.error({
      error: sanitizeForLog(error),
      merchantId,
      message: 'UCP cart availability check failed',
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: 'cart_availability_unknown',
          error: 'Cart availability could not be checked',
        },
        { status: 503 }
      ),
    };
  }
  if (enabled) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      {
        code: 'cart_unavailable',
        error: 'Cart transfer is not available for this store',
      },
      { status: 404 }
    ),
  };
}
