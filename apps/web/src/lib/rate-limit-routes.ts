interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitMatch {
  config: RateLimitConfig;
  pattern: string;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Submission writes have their own budget; typing and result reads do not consume it.
  '/api/search/submissions': { maxRequests: 20, windowMs: 60_000 },
  // Search assistance is an expensive public AI call — keep it at the same
  // per-IP budget as quiz generation instead of the generic 50/min default.
  '/api/search/assist': { maxRequests: 5, windowMs: 60_000 },
  // Migration preview validation polls the active job about once per second.
  // Keep this prefix above the default ceiling so the UI can stream progress
  // without tripping middleware rate limiting during normal use.
  '/api/import-jobs': { maxRequests: 240, windowMs: 60_000 },
  // Anonymous ad landings can arrive through carrier NAT bursts; the endpoint is
  // cheap and only returns validated Set-Cookie headers, so keep it above the
  // generic API ceiling to avoid losing paid-click attribution.
  '/api/attr': { maxRequests: 1000, windowMs: 60_000 },
  '/api/orders': { maxRequests: 10, windowMs: 60_000 },
  '/api/products': { maxRequests: 30, windowMs: 60_000 },
  // Keep autocomplete traffic from consuming the generic API budget before
  // the follow-up place-details request can complete.
  '/api/places': { maxRequests: 60, windowMs: 60_000 },
  // Keep a details lookup available even after a long autocomplete burst.
  '/api/places/details': { maxRequests: 60, windowMs: 60_000 },
  '/api/storefront': { maxRequests: 100, windowMs: 60_000 },
  '/api/storefront/negotiation-evidence': {
    maxRequests: 10,
    windowMs: 60_000,
  },
  '/api/storefront/imei-check': { maxRequests: 10, windowMs: 60_000 },
  '/api/storefront/auth/send-code': { maxRequests: 3, windowMs: 60_000 },
  '/api/storefront/auth/verify-code': { maxRequests: 5, windowMs: 60_000 },
  // Product-request intake writes to the merchant inbox. The DB also caps
  // each merchant at 50/hour, so bound one IP to 10/hour: a single caller
  // can no longer exhaust the merchant-wide budget, while genuine
  // zero-result requests (rare, form-gated) stay well under the ceiling
  // even behind carrier NAT.
  '/api/storefront/product-requests': {
    maxRequests: 10,
    windowMs: 3_600_000,
  },
  '/api/customers': { maxRequests: 20, windowMs: 60_000 },
  '/api/newsletter': { maxRequests: 5, windowMs: 900_000 },
  '/api/wallet': { maxRequests: 5, windowMs: 60_000 },
  '/api/payments/credit-direct/sign': { maxRequests: 5, windowMs: 60_000 },
  // Quiz: the Gemma generation route is an expensive AI call, and the claim
  // routes mint real prizes/cash — keep both well below the per-IP default.
  '/api/merchant/quiz/generate': { maxRequests: 5, windowMs: 60_000 },
  // Activation is a cheap DB status flip on its own path so it never competes
  // with the generation bucket — an admin can generate several drafts, then
  // review and open one without being throttled by the AI-call limit.
  '/api/merchant/quiz/activate': { maxRequests: 20, windowMs: 60_000 },
  '/api/quiz/attempts/start': { maxRequests: 20, windowMs: 60_000 },
  // A player refreshes live standings on a bounded timer. Keep this bucket
  // separate from unrelated API traffic so players behind one carrier NAT do
  // not exhaust the generic per-IP budget.
  '/api/quiz/leaderboard': { maxRequests: 120, windowMs: 60_000 },
  '/api/quiz/awards/cash/claim': { maxRequests: 10, windowMs: 60_000 },
  '/api/quiz/prizes/grand/claim': { maxRequests: 10, windowMs: 60_000 },
  default: { maxRequests: 50, windowMs: 60_000 },
};

const DYNAMIC_RATE_LIMITS: ReadonlyArray<{
  config: RateLimitConfig;
  pattern: string;
  pathname: RegExp;
}> = [
  {
    config: { maxRequests: 120, windowMs: 60_000 },
    pattern: '/api/quiz/attempts/:attemptId/result',
    pathname: /^\/api\/quiz\/attempts\/[^/]+\/result\/?$/,
  },
];

class TrieNode {
  children = new Map<string, TrieNode>();
  config: RateLimitConfig | null = null;
  pattern: string | null = null;
}

function buildTrie(patterns: Record<string, RateLimitConfig>): TrieNode {
  const root = new TrieNode();
  for (const [pattern, config] of Object.entries(patterns)) {
    if (pattern === 'default') continue;
    const segments = pattern.split('/').filter(Boolean);
    let node = root;
    for (const segment of segments) {
      let childNode = node.children.get(segment);
      if (!childNode) {
        childNode = new TrieNode();
        node.children.set(segment, childNode);
      }
      node = childNode;
    }
    node.config = config;
    node.pattern = pattern;
  }
  return root;
}

const rateLimitTrie = buildTrie(RATE_LIMITS);

export function getRateLimitConfig(pathname: string): RateLimitMatch {
  const dynamicMatch = DYNAMIC_RATE_LIMITS.find(({ pathname: matcher }) =>
    matcher.test(pathname)
  );
  if (dynamicMatch) {
    return { config: dynamicMatch.config, pattern: dynamicMatch.pattern };
  }

  const segments = pathname.split('/').filter(Boolean);
  let node = rateLimitTrie;
  let lastConfig: RateLimitConfig | null = null;
  let lastPattern: string | null = null;

  for (const segment of segments) {
    const childNode = node.children.get(segment);
    if (!childNode) break;
    node = childNode;
    if (node.config) {
      lastConfig = node.config;
      lastPattern = node.pattern;
    }
  }

  return {
    config: lastConfig ?? RATE_LIMITS.default,
    pattern: lastPattern ?? 'default',
  };
}
