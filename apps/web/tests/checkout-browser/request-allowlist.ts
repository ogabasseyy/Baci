interface FixtureRequest {
  url: string;
  method: string;
  resourceType: string;
  rsc?: string;
}
export function isFixtureAssetRequest(request: FixtureRequest): boolean {
  const url = new URL(request.url);
  if (url.origin !== 'http://127.0.0.1:3217' || request.method !== 'GET')
    return false;
  const isPage = [
    '/catalog',
    '/cart',
    '/checkout',
    '/payment-handoff',
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
