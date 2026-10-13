import {
  exchangeJumiaCode,
  sanitizeJumiaErrorDetails,
} from '@/lib/jumia/helpers';
import { logger } from '@/lib/logger';

export async function exchangeJumiaOAuthTokens({
  clientId,
  clientSecret,
  code,
  merchantId,
  redirectUri,
  variant,
}: {
  clientId: string;
  clientSecret: string;
  code: string;
  merchantId: string;
  redirectUri: string;
  variant?: string;
}): Promise<Awaited<ReturnType<typeof exchangeJumiaCode>>> {
  try {
    const tokens = await exchangeJumiaCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });

    if (variant) {
      logger.info({
        message: '[Jumia OAuth Variant Test]',
        variant,
        merchantId,
        has_access_token: Boolean(tokens.access_token),
        has_refresh_token: Boolean(tokens.refresh_token),
        has_refresh_expires_in: tokens.refresh_expires_in !== undefined,
        expires_in: tokens.expires_in,
        refresh_expires_in: tokens.refresh_expires_in ?? null,
        token_type: tokens.token_type,
      });
    }

    return tokens;
  } catch (tokenError) {
    const tokenErrorRecord =
      tokenError !== null && typeof tokenError === 'object'
        ? (tokenError as { details?: unknown; status?: number })
        : undefined;
    const tokenErrorDetails = sanitizeJumiaErrorDetails(
      tokenErrorRecord?.details
    );
    logger.error({
      message: 'Jumia Callback Token exchange failed',
      merchantId,
      redirectUri,
      error:
        tokenError instanceof Error
          ? {
              name: tokenError.name,
              message: tokenError.message,
              status: tokenErrorRecord?.status,
              ...(tokenErrorDetails === undefined
                ? {}
                : { details: tokenErrorDetails }),
            }
          : String(tokenError).slice(0, 200),
    });
    throw new Error('JUMIA_TOKEN_EXCHANGE_FAILED');
  }
}
