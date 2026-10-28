export interface HomepageHtmlGuardBudget {
  allowedHeroOrigins: readonly string[];
  baseOrigin?: string;
  forbidDataGifHeroSrc: boolean;
  maxHeadImagePreloads: number;
  maxHtmlBytes: number;
  maxInlineRscBytes: number;
  requireHeroOutsideHiddenSuspense: boolean;
  requirePreloadMatchesImgSrcSet: boolean;
}

export interface HeadJsGuardBudget {
  forbiddenChunkTokens: readonly string[];
  maxAsyncScriptCount: number;
  maxTotalBrotliBytes: number;
}

export type StorefrontCwvGuardRoute =
  | 'home'
  | 'category'
  | 'brandHub'
  | 'pdp'
  | 'blogPost';

export interface RouteCssGuardBudget {
  forbidListingFullStyleLoader: boolean;
  maxRenderBlockingStylesheets: Readonly<
    Record<StorefrontCwvGuardRoute, number>
  >;
  requireAuthorityHubLcpCopyLock: boolean;
  requireFooterLockInCriticalCss: boolean;
}

export interface HomepageHtmlGuardEvaluation {
  failures: string[];
  hasDataGifHeroSrc: boolean;
  headImagePreloads: number;
  heroInsideHiddenSuspense: boolean;
  heroUrls: string[];
  htmlBytes: number;
  inlineRscBytes: number;
  passed: boolean;
}

export interface HeadJsChunkContent {
  brotliBytes: number;
  raw: string;
}

export interface HeadJsGuardEvaluation {
  asyncScriptCount: number;
  failures: string[];
  forbiddenMatches: Array<{ chunkUrl: string; token: string }>;
  passed: boolean;
  totalBrotliBytes: number;
}

export interface RouteCssGuardEvaluation {
  failures: string[];
  passed: boolean;
  stylesheetCount: number;
}

export interface StorefrontCwvGuardBudgets {
  css: RouteCssGuardBudget;
  headJs: HeadJsGuardBudget;
  homepageHtml: HomepageHtmlGuardBudget;
}

/**
 * Initial budgets match current `origin/main` so PR #1 (Guards) passes and
 * blocks any outward regression while subsequent tracks ratchet each cap down:
 * - Home-1 (H1/H2): maxHeadImagePreloads -> 1, requirePreloadMatchesImgSrcSet -> true,
 *   requireHeroOutsideHiddenSuspense -> true, forbidDataGifHeroSrc -> true
 * - Category-1 (C1/C2): requireFooterLockInCriticalCss -> true,
 *   forbidListingFullStyleLoader -> true
 * - Home-2 (H3): maxHtmlBytes / maxInlineRscBytes ratcheted down
 * - Home-3 (H4): allowedHeroOrigins -> ['https://ogabassey.com']
 * - Hubs (A1): requireAuthorityHubLcpCopyLock -> true
 * - PDP/Blog (P1/P2): pdp -> 2, blogPost -> 2
 * - Head JS (X1/X3): maxAsyncScriptCount -> 15
 */
export const STOREFRONT_CWV_GUARD_BUDGETS: StorefrontCwvGuardBudgets = {
  homepageHtml: {
    allowedHeroOrigins: ['https://cdn.ogabassey.com', 'https://ogabassey.com'],
    baseOrigin: 'https://ogabassey.com',
    forbidDataGifHeroSrc: false,
    maxHeadImagePreloads: 2,
    maxHtmlBytes: 380_000,
    maxInlineRscBytes: 240_000,
    requireHeroOutsideHiddenSuspense: false,
    requirePreloadMatchesImgSrcSet: false,
  },
  headJs: {
    forbiddenChunkTokens: ['ZodError', 'GoTrueClient', 'RealtimeClient'],
    maxAsyncScriptCount: 30,
    maxTotalBrotliBytes: 260_000,
  },
  css: {
    forbidListingFullStyleLoader: false,
    maxRenderBlockingStylesheets: {
      home: 2,
      category: 2,
      brandHub: 2,
      pdp: 4,
      blogPost: 3,
    },
    requireAuthorityHubLcpCopyLock: false,
    requireFooterLockInCriticalCss: false,
  },
};
