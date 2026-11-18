import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockHost = 'ogabassey.usebaci.com';

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((name: string) => (name === 'host' ? mockHost : null)),
    })
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(async () => ({
    id: 'merchant-1',
    feature_settings: { blog_enabled: true },
  })),
}));

vi.mock('@/lib/storefront-route-identifier', () => ({
  resolveRouteIdentifier: vi.fn(() => 'ogabassey'),
}));

const SCRAPER_BOTS = [
  'Bytespider',
  'ClaudeBot',
  'GPTBot',
  'CCBot',
  'PetalBot',
  'SemrushBot',
  'AhrefsBot',
  'MJ12bot',
  'DotBot',
] as const;

const SEARCH_AND_ASSISTANT_BOTS = [
  '*',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
] as const;

describe('robots() compare path bot restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHost = 'ogabassey.usebaci.com';
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
  });

  it('disallows /compare/ and /*/compare* paths for scraper and AI training bots on storefronts', async () => {
    const {
      default: robots,
      COMPARE_DISALLOWED_PATHS,
      STOREFRONT_DISALLOWED_PATHS,
    } = await import('./robots');

    const result = await robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

    for (const bot of SCRAPER_BOTS) {
      const rule = rules.find((entry) => entry.userAgent === bot);
      expect(rule).toBeDefined();
      expect(rule?.allow).toBe('/');
      expect(rule?.disallow).toEqual([
        ...STOREFRONT_DISALLOWED_PATHS,
        ...COMPARE_DISALLOWED_PATHS,
      ]);
      expect(rule?.disallow).toContain('/compare/');
      expect(rule?.disallow).toContain('/*/compare');
      expect(rule?.disallow).toContain('/*/compare/*');
    }
  });

  it('preserves compare crawlability for default * and search/assistant bots', async () => {
    const { default: robots, COMPARE_DISALLOWED_PATHS } = await import(
      './robots'
    );

    const result = await robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

    for (const bot of SEARCH_AND_ASSISTANT_BOTS) {
      const rule = rules.find((entry) => entry.userAgent === bot);
      expect(rule).toBeDefined();
      const disallows = Array.isArray(rule?.disallow)
        ? rule.disallow
        : [rule?.disallow];
      for (const path of COMPARE_DISALLOWED_PATHS) {
        expect(disallows).not.toContain(path);
      }
    }
  });

  it('applies compare disallows to scraper bots on custom domains and platform domains alike', async () => {
    const { default: robots, COMPARE_DISALLOWED_PATHS } = await import(
      './robots'
    );

    for (const host of ['shop.ogabassey.com', 'usebaci.com']) {
      mockHost = host;
      const result = await robots();
      const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

      const defaultRule = rules.find((entry) => entry.userAgent === '*');
      for (const path of COMPARE_DISALLOWED_PATHS) {
        expect(defaultRule?.disallow).not.toContain(path);
      }

      for (const bot of SCRAPER_BOTS) {
        const rule = rules.find((entry) => entry.userAgent === bot);
        for (const path of COMPARE_DISALLOWED_PATHS) {
          expect(rule?.disallow).toContain(path);
        }
      }
    }
  });
});
