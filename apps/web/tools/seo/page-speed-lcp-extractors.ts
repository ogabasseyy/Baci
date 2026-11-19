import type {
  PageSpeedLcpSubparts,
  RawLighthouseAudit,
} from './page-speed-lcp-diagnostics.types';

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const getNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const parseOrigin = (url: string | null): string | null => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/** Computes the statistical median of a numeric array. */
export function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const isImageLcpNode = (
  sel: string | null,
  snip: string | null
): boolean =>
  Boolean(
    (snip && /^<(?:img|picture|source|svg|video)\b/i.test(snip)) ||
      (sel &&
        /(?:^|[\s>+~])(?:img|picture|source|svg|video)(?:[.#[:\s>+~]|$)/i.test(
          sel
        ))
  );

/** Matches a Lighthouse selector (with class/id qualifiers) against an expected terminal selector chain. */
export function matchesExpectedSelector(
  actual: string,
  expected: string
): boolean {
  if (actual === expected) return true;
  const actSegs = actual.split(/\s*>\s*/).filter(Boolean);
  const expSegs = expected.split(/\s*>\s*/).filter(Boolean);
  if (expSegs.length === 0 || actSegs.length < expSegs.length) return false;
  const tail = actSegs.slice(actSegs.length - expSegs.length);
  return expSegs.every((expSeg, i) => {
    const actSeg = tail[i] ?? '';
    const expTag = expSeg.match(/^[a-zA-Z0-9_-]+/)?.[0]?.toLowerCase() ?? '';
    const actTag = actSeg.match(/^[a-zA-Z0-9_-]+/)?.[0]?.toLowerCase() ?? '';
    if (expTag && actTag !== expTag) return false;
    const quals =
      expSeg
        .slice(expTag.length)
        .match(/(?:\.[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+|\[[^\]]+\])/g) ?? [];
    return quals.every((q) => actSeg.includes(q));
  });
}

export function extractLcpSelector(audits: Record<string, RawLighthouseAudit>) {
  const readNode = (e: unknown) => {
    if (!isRecord(e)) return null;
    const n = isRecord(e.node) ? e.node : e;
    const selector =
      typeof n.selector === 'string' ? n.selector.trim() || null : null;
    const snippet =
      typeof n.snippet === 'string' ? n.snippet.trim() || null : null;
    return selector || snippet ? { selector, snippet } : null;
  };
  for (const id of [
    'lcp-breakdown-insight',
    'lcp-discovery-insight',
    'largest-contentful-paint-element',
  ]) {
    for (const item of audits[id]?.details?.items ?? []) {
      const found =
        readNode(item) ??
        (isRecord(item) && Array.isArray(item.items)
          ? item.items.map(readNode).find(Boolean)
          : null);
      if (found) return found;
    }
  }
  return { selector: null, snippet: null };
}

export function extractLcpSubparts(
  audits: Record<string, RawLighthouseAudit>
): PageSpeedLcpSubparts {
  const s: PageSpeedLcpSubparts = {
    elementRenderDelayMs: null,
    resourceLoadDelayMs: null,
    resourceLoadDurationMs: null,
    ttfbMs: null,
  };
  for (const r of (
    audits['lcp-breakdown-insight']?.details?.items ?? []
  ).flatMap((it) =>
    isRecord(it) && Array.isArray(it.items) ? it.items : [it]
  )) {
    const d = isRecord(r) ? getNum(r.duration) : null;
    if (d === null || !isRecord(r)) continue;
    if (r.subpart === 'timeToFirstByte') s.ttfbMs = d;
    if (r.subpart === 'resourceLoadDelay') s.resourceLoadDelayMs = d;
    if (r.subpart === 'resourceLoadDuration') s.resourceLoadDurationMs = d;
    if (r.subpart === 'elementRenderDelay') s.elementRenderDelayMs = d;
  }
  return s;
}

export function resolveLcpResourceUrl(
  audits: Record<string, RawLighthouseAudit>,
  selector: string | null,
  snippet: string | null,
  cutoffMs: number | null
): string | null {
  if (!isImageLcpNode(selector, snippet)) return null;
  for (const id of ['lcp-discovery-insight', 'prioritize-lcp-image']) {
    for (const it of audits[id]?.details?.items ?? []) {
      if (
        isRecord(it) &&
        typeof it.url === 'string' &&
        it.url.startsWith('http')
      )
        return it.url;
    }
  }
  const rawSrc = snippet?.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? null;
  const isTrunc = Boolean(rawSrc && /(\u2026|\.\.\.)/.test(rawSrc));
  const prefix = rawSrc?.split(/\u2026|\.\.\./)[0]?.trim() ?? '';
  if (!prefix || prefix.startsWith('data:')) return null;
  const rawNet = audits['network-requests']?.details?.items;
  const net = Array.isArray(rawNet) ? rawNet.filter(isRecord) : [];
  const matches = net.filter(
    (r) =>
      typeof r.url === 'string' &&
      r.url.startsWith(prefix) &&
      (!r.resourceType || r.resourceType === 'Image') &&
      (cutoffMs === null ||
        (getNum(r.networkRequestTime) ?? getNum(r.startTime) ?? 0) <=
          cutoffMs + 50)
  );
  if (matches.length === 1 && typeof matches[0]?.url === 'string') {
    return matches[0].url;
  }
  return !isTrunc && rawSrc?.startsWith('http') ? rawSrc : null;
}
