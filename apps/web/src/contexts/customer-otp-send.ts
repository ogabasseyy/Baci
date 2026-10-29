import { CUSTOMER_OTP_TTL_SECONDS } from '@/lib/customer-auth-constants';

/** Conservative local estimate; the auth provider does not expose challenge expiry. */
export async function sendCustomerOtpRequest(
  email: string,
  merchantSlug: string
) {
  const requestedAt = Date.now();
  const response = await fetch('/api/storefront/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, merchantSlug }),
  });
  const data: { error?: string } = await response.json();
  if (!response.ok)
    return {
      success: false as const,
      error: data.error || 'Failed to send code',
    };
  return {
    success: true as const,
    expiresAt: requestedAt + CUSTOMER_OTP_TTL_SECONDS * 1000,
  };
}
