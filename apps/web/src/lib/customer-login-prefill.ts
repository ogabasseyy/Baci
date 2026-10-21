import {
  sanitizeCustomerLoginEmailHint,
  sanitizeMaskedCustomerLoginEmailHint,
} from '@baci/shared/schemas';

const RECEIPT_CLAIM_PATH_MARKER = '/receipts/claim/';

export function sanitizeCustomerLoginEmailPrefill(
  email: string | null
): string {
  return sanitizeCustomerLoginEmailHint(email);
}

export function getReceiptClaimTokenFromLoginRedirect(redirect: string) {
  // The claim page builds the redirect under the storefront base path
  // (`/<slug>/receipts/claim/<token>` on platform-hosted paths), so match
  // the claim segment anywhere in the path instead of anchoring at the
  // root. The query string is stripped first so a nested `redirect=`
  // parameter can never inject a token.
  const path = redirect.split(/[?#]/, 1)[0] ?? '';
  const markerIndex = path.indexOf(RECEIPT_CLAIM_PATH_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const token = path
    .slice(markerIndex + RECEIPT_CLAIM_PATH_MARKER.length)
    .split('/', 1)[0];

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
