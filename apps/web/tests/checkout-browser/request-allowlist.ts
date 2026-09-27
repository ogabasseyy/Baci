interface FixtureRequest {
  url: string;
  method: string;
  resourceType: string;
  rsc?: string;
}
export function isFixtureAssetRequest(request: FixtureRequest): boolean {
  const url = new URL(request.url);
  const configuredPort = process.env.CHECKOUT_BROWSER_PORT?.trim();
  const fixturePort = Number(configuredPort || 3217);
  if (
    url.origin !== `http://127.0.0.1:${fixturePort}` ||
    request.method !== 'GET'
  )
    return false;
  const isPage = [
    '/catalog',
    '/cart',
    '/checkout',
    '/crypto-payment-modal',
    '/payment-handoff',
    '/unlock-orders',
  ].includes(url.pathname);
  if (isPage)
    return (
      request.resourceType === 'document' ||
      (request.resourceType === 'fetch' &&
        request.rsc === '1' &&
        url.searchParams.has('_rsc'))
    );
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/phone.svg'
  );
}
