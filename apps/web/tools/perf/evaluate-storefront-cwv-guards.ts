import {
  type HeadJsChunkContent,
  type HeadJsGuardBudget,
  type HeadJsGuardEvaluation,
  type HomepageHtmlGuardBudget,
  type HomepageHtmlGuardEvaluation,
  type RouteCssGuardBudget,
  type RouteCssGuardEvaluation,
  STOREFRONT_CWV_GUARD_BUDGETS,
  type StorefrontCwvGuardRoute,
} from './storefront-cwv-guard-budgets';

function extractHeadSection(html: string): string {
  return html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
}

function getInlineRscBytes(html: string): number {
  let bytes = 0;
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].includes('self.__next_f.push'))
      bytes += Buffer.byteLength(m[1], 'utf8');
  }
  return bytes;
}

function extractHiddenSuspenseSections(html: string): string[] {
  const sections: string[] = [];
  const openRe = /<div\b[^>]*\bhidden\b[^>]*\bid=["']S:[^"']+["'][^>]*>/gi;
  for (const open of html.matchAll(openRe)) {
    const start = (open.index ?? 0) + open[0].length;
    const divRe = /<(\/?)div\b[^>]*>/gi;
    divRe.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let m = divRe.exec(html); m && depth > 0; m = divRe.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) end = m.index;
    }
    sections.push(html.slice(start, end));
  }
  return sections;
}

function extractImagePreloadTags(headHtml: string): string[] {
  return [...headHtml.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter(
      (t) => /\brel=["']preload["']/i.test(t) && /\bas=["']image["']/i.test(t)
    );
}

function extractAttribute(tag: string, attrName: string): string | null {
  return (
    tag.match(new RegExp(`\\b${attrName}=["']([^"']+)["']`, 'i'))?.[1] ?? null
  );
}

function parseSrcSetUrls(srcSet: string | null): string[] {
  if (!srcSet) return [];
  return srcSet
    .split(/,\s+/)
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((url): url is string => Boolean(url));
}

function isAllowedHeroUrl(
  rawUrl: string,
  allowedOrigins: readonly string[]
): boolean {
  const u = rawUrl.trim().split(/\s+/)[0] ?? '';
  if (
    !u ||
    u.startsWith('data:') ||
    u.startsWith('/cdn-image/') ||
    u.startsWith('/_next/')
  ) {
    return true;
  }
  try {
    return allowedOrigins.includes(new URL(u).origin);
  } catch {
    return false;
  }
}

export function evaluateHomepageHtmlGuard(
  html: string,
  budget: HomepageHtmlGuardBudget = STOREFRONT_CWV_GUARD_BUDGETS.homepageHtml
): HomepageHtmlGuardEvaluation {
  const failures: string[] = [];
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const inlineRscBytes = getInlineRscBytes(html);
  const headHtml = extractHeadSection(html);
  const preloadTags = extractImagePreloadTags(headHtml);
  const headImagePreloads = preloadTags.length;

  if (htmlBytes > budget.maxHtmlBytes) {
    failures.push(
      `HTML size ${htmlBytes}B exceeds budget ${budget.maxHtmlBytes}B`
    );
  }
  if (inlineRscBytes > budget.maxInlineRscBytes) {
    failures.push(
      `Inline RSC size ${inlineRscBytes}B exceeds budget ${budget.maxInlineRscBytes}B`
    );
  }
  if (headImagePreloads > budget.maxHeadImagePreloads) {
    failures.push(
      `Head image preload count ${headImagePreloads} exceeds budget ${budget.maxHeadImagePreloads}`
    );
  }

  const heroInsideHiddenSuspense = extractHiddenSuspenseSections(html).some(
    (s) =>
      /(?:<source\b[^>]*srcset=|<picture\b|\bfetchpriority=["']high["'])/i.test(
        s
      )
  );
  if (budget.requireHeroOutsideHiddenSuspense && heroInsideHiddenSuspense) {
    failures.push('Hero <picture>/<source> found inside hidden Suspense slot');
  }

  const heroImgTags = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /\bfetchpriority=["']high["']/i.test(t));
  const hasDataGifHeroSrc = heroImgTags.some((t) =>
    /\bsrc=["']data:image\/gif/i.test(t)
  );
  if (budget.forbidDataGifHeroSrc && hasDataGifHeroSrc) {
    failures.push('Hero <img> uses data:image/gif placeholder src');
  }

  const heroUrls = [
    ...preloadTags.flatMap((t) => [
      ...(extractAttribute(t, 'href')
        ? [extractAttribute(t, 'href') as string]
        : []),
      ...parseSrcSetUrls(extractAttribute(t, 'imageSrcSet')),
    ]),
    ...heroImgTags.flatMap((t) => {
      const src = extractAttribute(t, 'src');
      return [
        ...(src && !src.startsWith('data:') ? [src] : []),
        ...parseSrcSetUrls(extractAttribute(t, 'srcset')),
      ];
    }),
  ];
  for (const heroUrl of heroUrls) {
    if (!isAllowedHeroUrl(heroUrl, budget.allowedHeroOrigins)) {
      failures.push(`Disallowed hero image origin in URL: ${heroUrl}`);
    }
  }

  if (budget.requirePreloadMatchesImgSrcSet) {
    const pSet = preloadTags[0]
      ? extractAttribute(preloadTags[0], 'imageSrcSet')
      : null;
    const iSet = heroImgTags[0]
      ? extractAttribute(heroImgTags[0], 'srcset')
      : null;
    if (headImagePreloads !== 1) {
      failures.push(
        `Expected exactly 1 head image preload, found ${headImagePreloads}`
      );
    } else if (!pSet || !iSet || pSet !== iSet) {
      failures.push('Head preload imageSrcSet does not match hero img srcset');
    }
  }

  return {
    failures,
    hasDataGifHeroSrc,
    headImagePreloads,
    heroInsideHiddenSuspense,
    heroUrls,
    htmlBytes,
    inlineRscBytes,
    passed: failures.length === 0,
  };
}

export function evaluateHeadJsGuard(
  input: {
    chunkContents?: Readonly<Record<string, HeadJsChunkContent>>;
    html: string;
  },
  budget: HeadJsGuardBudget = STOREFRONT_CWV_GUARD_BUDGETS.headJs
): HeadJsGuardEvaluation {
  const failures: string[] = [];
  const headHtml = extractHeadSection(input.html);
  const scriptUrls = [
    ...headHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
  ].map((m) => m[1]);
  const asyncScriptCount = scriptUrls.length;
  if (asyncScriptCount > budget.maxAsyncScriptCount) {
    failures.push(
      `Head script count ${asyncScriptCount} exceeds budget ${budget.maxAsyncScriptCount}`
    );
  }
  for (const scriptUrl of scriptUrls) {
    if (!input.chunkContents?.[scriptUrl]) {
      failures.push(
        `Head script ${scriptUrl} has no chunk content; cannot verify tokens or size`
      );
    }
  }

  let totalBrotliBytes = 0;
  const forbiddenMatches: Array<{ chunkUrl: string; token: string }> = [];
  for (const [chunkUrl, chunk] of Object.entries(input.chunkContents ?? {})) {
    totalBrotliBytes += chunk.brotliBytes;
    for (const token of budget.forbiddenChunkTokens) {
      if (chunk.raw.includes(token)) {
        forbiddenMatches.push({ chunkUrl, token });
        failures.push(
          `Forbidden token "${token}" found in head chunk ${chunkUrl}`
        );
      }
    }
  }
  if (totalBrotliBytes > budget.maxTotalBrotliBytes) {
    failures.push(
      `Head JS brotli total ${totalBrotliBytes}B exceeds budget ${budget.maxTotalBrotliBytes}B`
    );
  }

  return {
    asyncScriptCount,
    failures,
    forbiddenMatches,
    passed: failures.length === 0,
    totalBrotliBytes,
  };
}

export function evaluateRouteCssGuard(
  input: {
    brandAuthoritySource?: string;
    criticalCss?: string;
    html?: string;
    listingLayoutSource?: string;
    route: StorefrontCwvGuardRoute;
    stylesheetCount?: number;
  },
  budget: RouteCssGuardBudget = STOREFRONT_CWV_GUARD_BUDGETS.css
): RouteCssGuardEvaluation {
  const failures: string[] = [];
  if (input.stylesheetCount === undefined && input.html === undefined) {
    failures.push(
      `Route "${input.route}" CSS check requires stylesheetCount or html`
    );
  }
  const headHtml = input.html ? extractHeadSection(input.html) : '';
  const stylesheetCount =
    input.stylesheetCount ??
    [...headHtml.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
      .length;
  const maxAllowed = budget.maxRenderBlockingStylesheets[input.route];
  if (stylesheetCount > maxAllowed) {
    failures.push(
      `Route "${input.route}" render-blocking stylesheet count ${stylesheetCount} exceeds budget ${maxAllowed}`
    );
  }
  if (
    budget.requireFooterLockInCriticalCss &&
    !/\.ogabassey-mobile-footer\s*\{[^}]*position:\s*fixed/i.test(
      input.criticalCss ?? ''
    )
  ) {
    failures.push(
      'Critical inline CSS is missing .ogabassey-mobile-footer { position: fixed } lock'
    );
  }
  if (
    budget.forbidListingFullStyleLoader &&
    input.listingLayoutSource?.includes('StorefrontFullStyleLoader')
  ) {
    failures.push(
      '(listing)/layout.tsx still references StorefrontFullStyleLoader'
    );
  }
  if (
    budget.requireAuthorityHubLcpCopyLock &&
    !(input.brandAuthoritySource ?? '').includes(
      'data-cwv-lcp-copy="authority-hub"'
    )
  ) {
    failures.push(
      'BrandAuthorityPageContent is missing data-cwv-lcp-copy="authority-hub"'
    );
  }
  return { failures, passed: failures.length === 0, stylesheetCount };
}
