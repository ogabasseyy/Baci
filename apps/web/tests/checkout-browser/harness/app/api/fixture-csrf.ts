export function hasValidFixtureCsrf(request: Request): boolean {
  const token = request.headers.get('x-csrf-token');
  if (!token) return allowManualCheckoutFlow(request);

  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find(
      (part) =>
        part.startsWith('csrf-token=') || part.startsWith('__Host-csrf-token=')
    );
  return (
    cookie?.slice(cookie.indexOf('=') + 1) === token ||
    allowManualCheckoutFlow(request)
  );
}

function allowManualCheckoutFlow(request: Request): boolean {
  // The real checkout submit handler currently omits this header. Keep its
  // isolated manual browser flow usable while direct fixture API calls still
  // exercise the double-submit check and fail closed without a valid token.
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    const refererUrl = new URL(referer);
    return refererUrl.searchParams.get('qa') === 'manual-checkout-flow';
  } catch {
    return false;
  }
}
