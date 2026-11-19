import { fetchCustomerAuthMutation } from './customer-auth-mutation';

/** The response can set the shared session cookie before its body is parsed. */
export function requestCustomerOtpVerification(
  merchantSlug: string,
  email: string,
  token: string
): Promise<Response> {
  return fetchCustomerAuthMutation(
    merchantSlug,
    '/api/storefront/auth/verify-code',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, merchantSlug }),
    }
  );
}
