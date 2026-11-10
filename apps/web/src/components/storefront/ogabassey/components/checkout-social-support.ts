/** Only offer checkout OAuth where the callback allowlist has been verified. */
export function supportsCheckoutSocialSignIn(hostname: string, isProduction: boolean): boolean {
  const host = hostname.toLowerCase();
  return host === 'ogabassey.com' || (!isProduction && (host === 'localhost' || host === '127.0.0.1'));
}
