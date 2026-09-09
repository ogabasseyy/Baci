import { ogabasseyCwvUtils } from './measure-ogabassey-cwv-utils.mjs';

const { BACI_CWV_FETCH_USER_AGENT } = ogabasseyCwvUtils;

function redactUrlForError(value) {
  try {
    const url = new URL(value);
    const secretKeys = new Set(['api_key', 'key', 'token']);
    for (const [param] of url.searchParams.entries()) {
      if (secretKeys.has(param.toLowerCase())) {
        url.searchParams.set(param, 'REDACTED');
      }
    }
    return url.toString();
  } catch {
    return `${value}`.replace(
      /([?&](?:api_key|key|token)=)[^&\s]+/gi,
      '$1REDACTED'
    );
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${redactUrlForError(url)} failed with ${response.status}: ${text}`
    );
  }
  return text ? JSON.parse(text) : {};
}

function getPathSegments(pathname) {
  return pathname.split('/').filter(Boolean);
}

function isBlogArticlePathForIndex(pathname, blogIndexPathname) {
  const blogIndexSegments = getPathSegments(blogIndexPathname);
  const blogIndex = blogIndexSegments.indexOf('blog');
  if (blogIndex < 0) return false;

  const storefrontPrefix = blogIndexSegments.slice(0, blogIndex);
  const segments = getPathSegments(pathname);
  if (segments[0] === 'api') return false;

  if (
    storefrontPrefix.some((segment, index) => segments[index] !== segment) ||
    segments[storefrontPrefix.length] !== 'blog'
  ) {
    return false;
  }

  const slug = segments[storefrontPrefix.length + 1];
  if (!slug) return false;

  const nonArticleSegments = new Set([
    'api',
    'author',
    'category',
    'feed',
    'news-sitemap.xml',
    'page',
    'rss',
    'sitemap.xml',
    'tag',
  ]);
  return !nonArticleSegments.has(slug.toLowerCase());
}

async function resolveLatestBlogPostUrl(blogUrl) {
  const explicitBlogPostUrl = process.env.OGABASSEY_BLOG_POST_URL?.trim() || '';
  if (explicitBlogPostUrl) {
    return explicitBlogPostUrl;
  }

  try {
    const response = await fetch(blogUrl, {
      headers: { 'user-agent': BACI_CWV_FETCH_USER_AGENT },
    });
    if (!response.ok) return null;

    const origin = new URL(blogUrl).origin;
    const html = await response.text();
    const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(
      (match) => match[1]
    );
    for (const href of matches) {
      try {
        const url = new URL(href, blogUrl);
        if (
          url.origin === origin &&
          isBlogArticlePathForIndex(url.pathname, new URL(blogUrl).pathname)
        ) {
          url.hash = '';
          url.search = '';
          return url.toString();
        }
      } catch {
        // Skip malformed hrefs and keep scanning the blog index.
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeUrlForPdpAudit(value) {
  const target = new URL(value);
  target.hash = '';
  if (target.pathname !== '/') {
    target.pathname = target.pathname.replace(/\/+$/, '');
  }
  return target;
}

function normalizeUrlForStrictPdpComparison(value) {
  const target = normalizeUrlForPdpAudit(value);
  target.search = '';
  return target;
}

function assertSamePdpTarget(candidate, requested, reason) {
  const candidateUrl = normalizeUrlForStrictPdpComparison(candidate);
  const requestedUrl = normalizeUrlForStrictPdpComparison(requested);

  if (candidateUrl.origin !== requestedUrl.origin) {
    throw new Error(
      `PDP canonical resolution changed origin from ${requestedUrl.origin} to ${candidateUrl.origin}`
    );
  }

  if (candidateUrl.pathname !== requestedUrl.pathname) {
    throw new Error(
      `PDP canonical resolution ${reason} changed path from ${requestedUrl.pathname} to ${candidateUrl.pathname}`
    );
  }

  return normalizeUrlForPdpAudit(requested).toString();
}

function getTagAttribute(tag, attributeName) {
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  return tag.match(pattern)?.[2] ?? null;
}

function getCanonicalHref(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getTagAttribute(tag, 'rel');
    if (` ${rel ?? ''} `.toLowerCase().includes(' canonical ')) {
      return getTagAttribute(tag, 'href');
    }
  }
  return null;
}

async function resolveCanonicalUrl(url) {
  const requested = normalizeUrlForPdpAudit(url).toString();

  const response = await fetch(requested, {
    headers: { 'user-agent': BACI_CWV_FETCH_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(
      `PDP canonical resolution failed for ${requested} with ${response.status}`
    );
  }

  const finalUrl = response.url ? response.url : requested;
  assertSamePdpTarget(finalUrl, requested, 'redirect');

  const html = await response.text();
  const href = getCanonicalHref(html);
  if (!href) return requested;

  return assertSamePdpTarget(
    new URL(href, requested).toString(),
    requested,
    'canonical'
  );
}

async function resolveCanonicalUrlOrFailure(
  url,
  { label = 'pdp', resolveCanonicalUrlImpl = resolveCanonicalUrl } = {}
) {
  try {
    return { url: await resolveCanonicalUrlImpl(url) };
  } catch (error) {
    return {
      failure: {
        label,
        message: error instanceof Error ? error.message : String(error),
        source: 'target-resolution',
      },
      url,
    };
  }
}

export const ogabasseyCwvNetwork = Object.freeze({
  fetchJson,
  resolveLatestBlogPostUrl,
  resolveCanonicalUrl,
  resolveCanonicalUrlOrFailure,
});
