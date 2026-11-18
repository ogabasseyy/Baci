// Classifies errors from a Supabase Auth lookup for the quiz routes: which
// ones mean "this credential is bad" (401) and which mean "Auth could not
// answer" (503). Only safe fields are read, never the raw error object.

export function getSafeAuthErrorFields(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { errorMessage: String(error) };
  }

  const fields: {
    errorCode?: string;
    errorMessage?: string;
    errorStatus?: number;
  } = {};
  if (
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    fields.errorMessage = (error as { message: string }).message;
  }
  if (
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    fields.errorCode = (error as { code: string }).code;
  }
  if (
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    fields.errorStatus = (error as { status: number }).status;
  }

  return fields;
}

export function isMissingAuthSession(error: unknown) {
  const fields = getSafeAuthErrorFields(error);
  const errorMessage = fields.errorMessage?.toLowerCase() ?? '';
  const errorCode = fields.errorCode?.toLowerCase() ?? '';

  return (
    errorMessage.includes('auth session missing') ||
    errorMessage.includes('session missing') ||
    errorCode === 'session_not_found' ||
    errorCode === 'auth_session_missing' ||
    errorCode === 'no_authorization' ||
    (fields.errorStatus === 400 && errorMessage.includes('session'))
  );
}

// Supabase Auth answers a bad, expired or revoked token with a 4xx. Request
// timeout (408) and rate limiting (429) are about the service, not the token.
export function isRejectedCredentialError(error: unknown) {
  const { errorStatus } = getSafeAuthErrorFields(error);
  return (
    errorStatus !== undefined &&
    errorStatus >= 400 &&
    errorStatus < 500 &&
    errorStatus !== 408 &&
    errorStatus !== 429
  );
}
