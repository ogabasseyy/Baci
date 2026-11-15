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
    url.searchParams.size === 0 &&
    method === 'GET'
  )
    return true;
  if (!fixtureVisited) return false;
  if (
    ['https://support.example.test', 'https://untrusted.example.test'].includes(
      url.origin
    ) &&
    url.pathname === '/widget' &&
    url.searchParams.size === 0 &&
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
