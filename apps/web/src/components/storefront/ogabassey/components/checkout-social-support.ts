/** Only offer checkout OAuth where the callback allowlist has been verified. */
export function supportsCheckoutSocialSignIn(
  hostname: string,
  isProduction: boolean
): boolean {
  const host = hostname.toLowerCase();
  if (!isProduction && (host === 'localhost' || host === '127.0.0.1')) {
    return true;
  }
  return host === 'ogabassey.com' || host === 'www.ogabassey.com';
}
