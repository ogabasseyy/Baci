export interface NavigationState {
  epoch: number;
  instanceId: string;
  shopperPartition: string;
  transition: boolean;
  active: boolean;
}
export interface PresentedCanonicalLink {
  href: string;
  presentationId: string;
}

export function splitExperienceOpenPath(rawPath: string): {
  pathname: string;
  suffix: string;
} {
  if (
    typeof rawPath !== 'string' ||
    rawPath.length === 0 ||
    rawPath.length > 500 ||
    !rawPath.startsWith('/') ||
    rawPath.startsWith('//') ||
    rawPath.includes('\\') ||
    [...rawPath].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
  ) {
    throw Error('INVALID_REQUEST');
  }
  const cut = rawPath.search(/[?#]/);
  const pathname = cut === -1 ? rawPath : rawPath.slice(0, cut);
  if (
    !pathname ||
    pathname.includes('%') ||
    !/^\/[a-zA-Z0-9_/-]*$/.test(pathname) ||
    pathname.includes('//') ||
    pathname.split('/').some((p) => p === '.' || p === '..')
  ) {
    throw Error('INVALID_REQUEST');
  }
  if (cut === -1) return { pathname, suffix: '' };
  let parsed: URL;
  try {
    parsed = new URL(rawPath, 'https://storefront.baci.internal');
  } catch {
    throw Error('INVALID_REQUEST');
  }
  if (
    parsed.origin !== 'https://storefront.baci.internal' ||
    parsed.pathname !== pathname
  ) {
    throw Error('INVALID_REQUEST');
  }
  if (parsed.search && /%(?![0-9a-fA-F]{2})/.test(parsed.search)) {
    throw Error('INVALID_REQUEST');
  }
  let searchSuffix = '';
  if (parsed.search) {
    try {
      const canonicalSearch = new URLSearchParams(parsed.search).toString();
      searchSuffix = canonicalSearch ? `?${canonicalSearch}` : '';
    } catch {
      throw Error('INVALID_REQUEST');
    }
  }
  if (parsed.hash && !/^#[a-zA-Z0-9_-]*$/.test(parsed.hash)) {
    throw Error('INVALID_REQUEST');
  }
  const hashSuffix = parsed.hash && parsed.hash !== '#' ? parsed.hash : '';
  return { pathname, suffix: `${searchSuffix}${hashSuffix}` };
}

export function canonicalExperiencePath(
  base: string,
  routes: string[],
  path: string
) {
  if (
    !/^\/[a-zA-Z0-9_/-]*$/.test(path) ||
    path.includes('//') ||
    path.split('/').some((p) => p === '.' || p === '..') ||
    /^\/(checkout|cart|admin|api|auth|dashboard)(\/|$)/.test(path)
  )
    throw Error('INVALID_REQUEST');
  const match = routes.some((route) => {
    const pattern = route
      .split('/')
      .map((part) =>
        /^\[[a-zA-Z][a-zA-Z0-9_]*\]$/.test(part)
          ? '[a-zA-Z0-9_-]+'
          : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      )
      .join('/');
    return new RegExp(`^${pattern}$`).test(path);
  });
  if (!match) throw Error('NOT_FOUND');
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw Error('INVALID_REQUEST');
  return url.origin + url.pathname.replace(/\/$/, '') + path;
}
/** Canonical base comes from trusted merchant/store-url resolution, never a frame URL. */
export function createNavigationPresentation(deps: {
  base: string;
  routes: string[];
  state: () => NavigationState;
  now: () => number;
}) {
  let active: {
    link: PresentedCanonicalLink;
    stamp: string;
    expiresAt: number;
    requestId: string;
    path: string;
  } | null = null;
  let last = Number.NEGATIVE_INFINITY;
  let count = 0;
  const replay = new Map<
    string,
    { path: string; link: PresentedCanonicalLink; stamp: string }
  >();
  const stamp = () => JSON.stringify(deps.state());
  const current = () => {
    const s = deps.state();
    if (
      active &&
      (!s.active ||
        s.transition ||
        active.stamp !== stamp() ||
        active.expiresAt <= deps.now())
    )
      active = null;
    return active?.link ?? null;
  };
  return {
    // resolvedPath is supplied only by the trusted host catalog resolver.
    presentCanonicalLink(
      input: { requestId: string; path: string },
      resolvedPath?: string
    ) {
      const s = deps.state();
      if (s.transition) throw Error('ROUTE_TRANSITION');
      if (!s.active) throw Error('LAUNCH_EXPIRED');
      const { pathname, suffix } = splitExperienceOpenPath(input.path);
      const normalizedTarget = `${pathname}${suffix}`;
      const baseHref = canonicalExperiencePath(
        deps.base,
        resolvedPath ? [resolvedPath] : deps.routes,
        pathname
      );
      const href = `${baseHref}${suffix}`;
      const old = replay.get(input.requestId);
      if (old) {
        if (old.path !== normalizedTarget) throw Error('IDEMPOTENCY_CONFLICT');
        if (old.stamp !== stamp() || current() !== old.link)
          throw Error('STALE_ROUTE');
        return old.link;
      }
      if (current() || deps.now() - last < 500) throw Error('QUOTA_EXCEEDED');
      // Only a completed/cancelled presentation can reach this eviction.
      if (replay.size >= 256) {
        const oldest = replay.keys().next().value;
        if (oldest !== undefined) replay.delete(oldest);
      }
      const link = { href, presentationId: `link-${++count}` };
      active = {
        link,
        stamp: stamp(),
        expiresAt: deps.now() + 30000,
        requestId: input.requestId,
        path: normalizedTarget,
      };
      replay.set(input.requestId, {
        path: normalizedTarget,
        link,
        stamp: stamp(),
      });
      last = deps.now();
      return link;
    },
    current,
    cancel() {
      active = null;
    },
  };
}
