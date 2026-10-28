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
import {
  buildStorefrontCssGuardInput,
  countCssImportsInSource,
  countStorefrontRouteCssImports,
  extractAsyncHeadScriptUrls,
  extractAttribute,
  extractHeadSection,
  extractHiddenSuspenseSections,
  extractImagePreloadTags,
  getInlineRscBytes,
  hasBooleanAttribute,
  isAllowedHeroUrl,
  loadHeadChunkContentsFromBuildDir,
  parseSrcSetUrls,
} from './storefront-cwv-html-utils';

export {
  countCssImportsInSource,
  countStorefrontRouteCssImports,
  loadHeadChunkContentsFromBuildDir,
};

/** Evaluates homepage HTML against CWV size, preload, Suspense-split, placeholder, and origin budgets. */
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

  const hiddenSections = extractHiddenSuspenseSections(html);
  const heroInsideHiddenSuspense = hiddenSections.some((s) =>
    /(?:<source\b[^>]*srcset=|\bfetchpriority=["']high["']|\bdata-ogabassey-mobile-hero\b)/i.test(
      s
    )
  );
  if (budget.requireHeroOutsideHiddenSuspense && heroInsideHiddenSuspense) {
    failures.push('Hero <picture>/<source> found inside hidden Suspense slot');
  }

  const heroPictures = [
    ...html.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi),
  ]
    .map((m) => m[0])
    .filter((p) => /\bfetchpriority=["']high["']/i.test(p));
  const heroImgTags = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /\bfetchpriority=["']high["']/i.test(t));
  if (heroImgTags.length === 0) {
    failures.push('No hero <img> with fetchpriority="high" found');
  }
  const hasDataGifHeroSrc = heroImgTags.some((t) =>
    /\bsrc=["']data:image\/gif/i.test(t)
  );
  if (budget.forbidDataGifHeroSrc && hasDataGifHeroSrc) {
    failures.push('Hero <img> uses data:image/gif placeholder src');
  }

  const heroSourceTags = [...heroPictures, ...hiddenSections].flatMap((b) =>
    [...b.matchAll(/<source\b[^>]*>/gi)].map((m) => m[0])
  );
  const heroSourceSrcSets = heroSourceTags
    .map((t) => extractAttribute(t, 'srcset'))
    .filter((s): s is string => Boolean(s));
  const mobileHeroSourceSrcSets = heroSourceTags
    .filter((t) => extractAttribute(t, 'media') === '(max-width: 767px)')
    .map((t) => extractAttribute(t, 'srcset'))
    .filter((s): s is string => Boolean(s));
  const heroUrls = [
    ...preloadTags.flatMap((t) => [
      ...(extractAttribute(t, 'href')
        ? [extractAttribute(t, 'href') as string]
        : []),
      ...parseSrcSetUrls(extractAttribute(t, 'imageSrcSet')),
    ]),
    ...heroSourceSrcSets.flatMap((s) => parseSrcSetUrls(s)),
    ...heroImgTags.flatMap((t) => {
      const src = extractAttribute(t, 'src');
      return [
        ...(src && !src.startsWith('data:') ? [src] : []),
        ...parseSrcSetUrls(extractAttribute(t, 'srcset')),
      ];
    }),
  ];
  for (const heroUrl of heroUrls) {
    if (
      !isAllowedHeroUrl(heroUrl, budget.allowedHeroOrigins, budget.baseOrigin)
    ) {
      failures.push(`Disallowed hero image origin in URL: ${heroUrl}`);
    }
  }

  if (budget.requirePreloadMatchesImgSrcSet) {
    const pTag = preloadTags[0] ?? '';
    const iTag = heroImgTags[0] ?? '';
    const pSet = extractAttribute(pTag, 'imageSrcSet');
    const iSet = extractAttribute(iTag, 'srcset');
    const matchesSrcSet =
      Boolean(pSet) &&
      (pSet === iSet || mobileHeroSourceSrcSets.includes(pSet));
    if (headImagePreloads !== 1) {
      failures.push(
        `Expected exactly 1 head image preload, found ${headImagePreloads}`
      );
    } else if (!matchesSrcSet) {
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

/** Evaluates `<head>` async script count, chunk brotli total, and forbidden tokens for head-referenced scripts. */
export function evaluateHeadJsGuard(
  input: {
    chunkContents?: Readonly<Record<string, HeadJsChunkContent>>;
    html: string;
  },
  budget: HeadJsGuardBudget = STOREFRONT_CWV_GUARD_BUDGETS.headJs
): HeadJsGuardEvaluation {
  const failures: string[] = [];
  const headHtml = extractHeadSection(input.html);
  const scriptUrls = extractAsyncHeadScriptUrls(headHtml);
  const asyncScriptCount = scriptUrls.length;
  if (asyncScriptCount > budget.maxAsyncScriptCount) {
    failures.push(
      `Head script count ${asyncScriptCount} exceeds budget ${budget.maxAsyncScriptCount}`
    );
  }

  let totalBrotliBytes = 0;
  const forbiddenMatches: Array<{ chunkUrl: string; token: string }> = [];
  for (const scriptUrl of [...new Set(scriptUrls)]) {
    const chunk = input.chunkContents?.[scriptUrl];
    if (!chunk) {
      failures.push(
        `Head script ${scriptUrl} has no chunk content; cannot verify tokens or size`
      );
      continue;
    }
    totalBrotliBytes += chunk.brotliBytes;
    for (const token of budget.forbiddenChunkTokens) {
      if (chunk.raw.includes(token)) {
        forbiddenMatches.push({ chunkUrl: scriptUrl, token });
        failures.push(
          `Forbidden token "${token}" found in head chunk ${scriptUrl}`
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

/** Evaluates route render-blocking stylesheet counts and route-scoped critical CSS locks. */
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
    [...headHtml.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter(
        (t) =>
          /\brel=["']stylesheet["']/i.test(t) &&
          !hasBooleanAttribute(t, 'disabled') &&
          !/\bmedia=["']print["']/i.test(t)
      ).length;
  const maxAllowed = budget.maxRenderBlockingStylesheets[input.route];
  if (stylesheetCount > maxAllowed) {
    failures.push(
      `Route "${input.route}" render-blocking stylesheet count ${stylesheetCount} exceeds budget ${maxAllowed}`
    );
  }
  const checksFooterLock =
    input.criticalCss !== undefined ||
    input.route === 'home' ||
    input.route === 'category' ||
    input.route === 'brandHub';
  if (
    budget.requireFooterLockInCriticalCss &&
    checksFooterLock &&
    !/\.ogabassey-mobile-footer\s*\{[^}]*position:\s*fixed/i.test(
      input.criticalCss ?? ''
    )
  ) {
    failures.push(
      'Critical inline CSS is missing .ogabassey-mobile-footer { position: fixed } lock'
    );
  }
  const isListing = input.route === 'category' || input.route === 'brandHub';
  if (
    budget.forbidListingFullStyleLoader &&
    isListing &&
    (!input.listingLayoutSource ||
      input.listingLayoutSource.includes('StorefrontFullStyleLoader'))
  ) {
    failures.push(
      '(listing)/layout.tsx still references StorefrontFullStyleLoader'
    );
  }
  if (
    budget.requireAuthorityHubLcpCopyLock &&
    input.route === 'brandHub' &&
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

/** Evaluates all 5 storefront routes against real source files in `apps/web/src`. */
export function evaluateStorefrontSourceCssGuards(
  webSrcDir: string,
  criticalCss: string,
  budget: RouteCssGuardBudget = STOREFRONT_CWV_GUARD_BUDGETS.css
): Record<StorefrontCwvGuardRoute, RouteCssGuardEvaluation> {
  const evalRoute = (route: StorefrontCwvGuardRoute): RouteCssGuardEvaluation =>
    evaluateRouteCssGuard(
      buildStorefrontCssGuardInput(route, webSrcDir, criticalCss),
      budget
    );
  return {
    blogPost: evalRoute('blogPost'),
    brandHub: evalRoute('brandHub'),
    category: evalRoute('category'),
    home: evalRoute('home'),
    pdp: evalRoute('pdp'),
  };
}
