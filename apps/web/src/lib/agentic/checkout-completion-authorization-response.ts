import { getAgenticConfirmationKeys } from '@/env';
import type { AgenticMetadata } from '@/lib/agentic/checkout-storage';
import { logger } from '@/lib/logger';

export { getCheckoutGrandTotal } from './checkout-totals';

export type CheckoutAuthorizationErrorCode =
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_INVALID'
  | 'CONFIRMATION_MISMATCH'
  | 'CONFIRMATION_REQUIRED'
  | 'SERVER_CONFIGURATION_ERROR';

export type CheckoutAuthorizationErrorBody = {
  code: CheckoutAuthorizationErrorCode;
  error: string;
  retryable: boolean;
};

export function getCheckoutCompletionAuthorizationSecrets(): string[] {
  return getAgenticConfirmationKeys();
}

export function buildAuthorizationErrorBody(
  code: CheckoutAuthorizationErrorCode
): CheckoutAuthorizationErrorBody {
  if (code === 'CONFIRMATION_REQUIRED') {
    return {
      code,
      error: 'Human confirmation required',
      retryable: true,
    };
  }

  if (code === 'SERVER_CONFIGURATION_ERROR') {
    logger.error({
      code,
      message: 'Agentic checkout authorization key is not configured',
    });
    return {
      code,
      error: 'Checkout authorization is temporarily unavailable',
      retryable: false,
    };
  }

  return {
    code,
    error: 'Checkout authorization invalid',
    retryable: false,
  };
}

export function getAuthorizationErrorStatus(
  code: CheckoutAuthorizationErrorCode
): number {
  if (code === 'CONFIRMATION_REQUIRED') {
    return 428;
  }

  if (code === 'SERVER_CONFIGURATION_ERROR') {
    return 503;
  }

  return 403;
}

export function withCompletionAuthorizationMetadata(
  metadata: AgenticMetadata,
  authorizationMode: string
): AgenticMetadata {
  const existingCompletion = metadata.agentic?.completion;
  const completion =
    existingCompletion &&
    typeof existingCompletion === 'object' &&
    !Array.isArray(existingCompletion)
      ? existingCompletion
      : {};

  return {
    ...metadata,
    agentic: {
      ...(metadata.agentic ?? {}),
      completion: {
        ...completion,
        authorization_mode: authorizationMode,
      },
    },
  };
}
