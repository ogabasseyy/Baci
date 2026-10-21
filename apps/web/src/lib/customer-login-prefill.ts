import {
  sanitizeCustomerLoginEmailHint,
  sanitizeMaskedCustomerLoginEmailHint,
} from '@baci/shared/schemas';

const RECEIPT_CLAIM_REDIRECT_PREFIX = '/receipts/claim/';

export function sanitizeCustomerLoginEmailPrefill(
  email: string | null
): string {
  return sanitizeCustomerLoginEmailHint(email);
}

export function getReceiptClaimTokenFromLoginRedirect(redirect: string) {
  if (!redirect.startsWith(RECEIPT_CLAIM_REDIRECT_PREFIX)) {
    return null;
  }

  const tokenWithMaybeSearch = redirect.slice(
    RECEIPT_CLAIM_REDIRECT_PREFIX.length
  );
  const token = tokenWithMaybeSearch.split(/[?#]/, 1)[0];

  return token || null;
}

// The claim login hint is a masked address fragment (never the full
// recipient email): callers display it as sign-in guidance, never as an
// input value.
export async function fetchCustomerLoginEmailHintForRedirect(
  redirect: string,
  fetchImpl: typeof fetch = fetch
) {
  const token = getReceiptClaimTokenFromLoginRedirect(redirect);
  if (!token) {
    return '';
  }

  try {
    const response = await fetchImpl(
      `/api/storefront/receipts/claims/${encodeURIComponent(token)}/login-email`,
      { headers: { accept: 'application/json' } }
    );

    if (!response.ok) {
      return '';
    }

    const body: unknown = await response.json();
    const emailHint =
      body && typeof body === 'object' && 'emailHint' in body
        ? body.emailHint
        : null;

    return typeof emailHint === 'string'
      ? sanitizeMaskedCustomerLoginEmailHint(emailHint)
      : '';
  } catch {
    return '';
  }
}
