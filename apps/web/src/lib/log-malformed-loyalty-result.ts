import { logger } from '@/lib/logger';

/**
 * Logs a malformed loyalty RPC payload without the payload itself:
 * status and redeem results carry spendable redemption codes, so only
 * the validation issue codes/paths (which identify the schema drift)
 * may reach log storage.
 */
export function logMalformedLoyaltyResult(
  message: string,
  issues: readonly { code: string; path: PropertyKey[] }[]
): void {
  logger.error({
    message,
    error: {
      issues: issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
      })),
    },
  });
}
