export function buildDeclaredRouteMatcherSnippet(): string {
  return `
function safeDecodeSegment(raw) {
  try { return decodeURIComponent(raw); } catch { return null; }
}

function isDynamicRouteSegment(seg) {
  return seg.startsWith(':') || (seg.startsWith('[') && seg.endsWith(']'));
}

const RANKED_DECLARED_ROUTES = (Array.isArray(DECLARED_ROUTES) ? DECLARED_ROUTES : [])
  .map((route, idx) => {
    const segs = typeof route?.path === 'string' ? route.path.split('/').filter(Boolean) : [];
    const dynFlags = segs.map(isDynamicRouteSegment);
    const staticCount = dynFlags.filter((d) => !d).length;
    return { route, idx, segs, dynFlags, staticCount };
  })
  .sort((a, b) => {
    if (b.staticCount !== a.staticCount) return b.staticCount - a.staticCount;
    const minLen = Math.min(a.dynFlags.length, b.dynFlags.length);
    for (let i = 0; i < minLen; i++) {
      if (a.dynFlags[i] !== b.dynFlags[i]) return a.dynFlags[i] ? 1 : -1;
    }
    return a.idx - b.idx;
  });

function matchDeclaredRoute(pathname) {
  if (pathname === '/_baci' || pathname.startsWith('/_baci/')) return null;
  const reqSegs = pathname.split('/').filter(Boolean);
  for (const entry of RANKED_DECLARED_ROUTES) {
    const { route, segs, dynFlags } = entry;
    if (segs.length !== reqSegs.length) continue;
    const params = Object.create(null);
    let matched = true;
    for (let i = 0; i < segs.length; i++) {
      const pat = segs[i];
      const seg = reqSegs[i];
      if (dynFlags[i]) {
        const decoded = safeDecodeSegment(seg);
        if (decoded === null) return { view: 'bad_request', params: {} };
        params[pat.startsWith(':') ? pat.slice(1) : pat.slice(1, -1)] = decoded;
      } else if (pat !== seg) {
        matched = false;
        break;
      }
    }
    if (matched) return { view: route.view, params };
  }
  return null;
}
`;
}
