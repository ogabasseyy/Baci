/** Only public, immutable framework assets on the already bound storefront. */
export function publicFrameworkRequest(
  origin: string,
  request: { url: string; method: string; body?: string }
): 'js' | 'css' | null {
  try {
    if (
      request.method !== 'GET' ||
      request.body !== undefined ||
      request.url.includes('%') ||
      request.url.includes('\\')
    )
      return null;
    const url = new URL(request.url);
    if (
      url.href !== request.url ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/_next\/static\/[A-Za-z0-9_./-]+\.(js|css)$/.test(url.pathname) ||
      url.pathname.split('/').some((part) => part === '.' || part === '..') ||
      (url.search !== '' && !/^\?dpl=[A-Za-z0-9_-]{1,128}$/.test(url.search))
    )
      return null;
    return url.pathname.endsWith('.css') ? 'css' : 'js';
  } catch {
    return null;
  }
}
