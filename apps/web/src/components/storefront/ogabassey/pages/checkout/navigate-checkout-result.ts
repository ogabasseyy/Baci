/** Oxygen's hosted frames need the checkout document's response policies. */
export function navigateCheckoutResult(
  path: string,
  clientNavigate: (path: string) => void,
  documentNavigate: (path: string) => void
) {
  const url = new URL(path, window.location.origin);
  if (
    url.origin === window.location.origin &&
    /(?:^|\/)checkout\/?$/.test(url.pathname) &&
    url.searchParams.has('oxygenOrderId')
  ) {
    documentNavigate(path);
    return;
  }
  clientNavigate(path);
}
