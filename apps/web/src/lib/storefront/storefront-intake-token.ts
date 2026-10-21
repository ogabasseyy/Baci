import 'server-only';

/** Reject privileged/misconfigured credentials before constructing a client.
 * Supabase verifies the JWT signature; this local check constrains configuration.
 */
export function getStorefrontIntakeToken(): string {
  const token = process.env.SUPABASE_STOREFRONT_INTAKE_KEY;
  try {
    if (token?.split('.').length !== 3) throw new Error();
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    if (
      !claims ||
      typeof claims !== 'object' ||
      !('role' in claims) ||
      claims.role !== 'storefront_intake'
    )
      throw new Error();
  } catch {
    throw new Error('Restricted storefront intake credential is unavailable');
  }
  return token;
}
