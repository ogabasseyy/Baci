/** Only offer checkout OAuth where the callback allowlist has been verified. */
export function supportsCheckoutSocialSignIn(
  hostname: string,
  isProduction: boolean,
  customDomain?: string | null
): boolean {
  const host = hostname.toLowerCase();
  if (!isProduction && (host === 'localhost' || host === '127.0.0.1')) {
    return true;
  }
  if (host === 'ogabassey.com' || host === 'www.ogabassey.com') {
    return true;
  }
  if (customDomain) {
    const normalized = customDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    const bareHost = normalized.replace(/^www\./, '');
    if (bareHost && (host === bareHost || host === `www.${bareHost}`)) {
      return true;
    }
  }
  return false;
}
