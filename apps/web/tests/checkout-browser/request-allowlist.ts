interface FixtureRequest {
  url: string;
  method: string;
  resourceType: string;
  rsc?: string;
}

interface ChatwootFixtureRequest {
  url: string;
  method: string;
  harnessOrigin: string;
  fixtureVisited: boolean;
}

export function isChatwootBridgeFixtureRequest({
  url: requestUrl,
  method,
  harnessOrigin,
  fixtureVisited,
}: ChatwootFixtureRequest): boolean {
  const url = new URL(requestUrl);
  if (
    url.origin === harnessOrigin &&
    url.pathname === '/chatwoot-bridge' &&
    method === 'GET'
  )
    return true;
  if (!fixtureVisited) return false;
  if (
    ['https://support.example.test', 'https://untrusted.example.test'].includes(
      url.origin
    ) &&
    url.pathname === '/widget' &&
    method === 'GET'
  )
    return true;
  return (
    url.origin === harnessOrigin &&
    /^\/api\/storefront\/chatwoot\/context\/(?:challenge|verify|authorize)$/.test(
      url.pathname
    ) &&
    url.searchParams.size === 1 &&
    url.searchParams.get('merchantSlug') === 'ogabassey' &&
    method === 'POST'
  );
}

export function isChatwootTargetOriginBlockedMessage(message: string): boolean {
  return (
    /post.?message/i.test(message) &&
    message.includes('https://support.example.test') &&
    message.includes('https://untrusted.example.test')
  );
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
    '/cart-navigation-start',
    '/checkout',
    '/checkout-shared',
    '/crypto-payment-modal',
    '/dva-modal',
    '/oxygen-theme',
    '/payment-handoff',
    '/products/test-phone',
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
