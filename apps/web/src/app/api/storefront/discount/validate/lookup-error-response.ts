import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Lookup-failure response for the validate route (split out: the route
 * sits at the 300-line limit). A failed RPC is a retryable server
 * failure, never an invalid code.
 */
export function lookupErrorResponse(
  message: string,
  error: unknown,
  merchantId: string
) {
  logger.error({ message, error, merchantId });
  return NextResponse.json(
    { valid: false, error: 'Internal server error' },
    { status: 500 }
  );
}
