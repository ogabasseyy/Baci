// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockHost = 'ogabassey.com';
let mockBlogEnabled = true;

vi.mock('next/headers', () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((name: string) => {
        if (name === 'host') return mockHost;
        return null;
      }),
    })
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(async () => ({ id: 'merchant-1' })),
  getCachedFeatureSettings: vi.fn(async () => ({
    blog_enabled: mockBlogEnabled,
  })),
}));

vi.mock('@/lib/storefront-route-identifier', () => ({
  resolveRouteIdentifier: vi.fn(() => 'ogabassey'),
}));

function expectStandardsOnlyRobots(body: string): void {
  const nonStandardDirectivePattern = /^(content-signal|host|crawl-delay):/gim;

  expect(body).not.toMatch(nonStandardDirectivePattern);
}

describe('GET /api/robots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock('@/app/robots');
    mockHost = 'ogabassey.com';
    mockBlogEnabled = true;
  });

  it('serializes robots.txt with Lighthouse-valid crawler directives', async () => {
    const { GET } = await import('./route');
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=300, s-maxage=300'
    );
    expect(body).toContain('User-Agent: *');
    expectStandardsOnlyRobots(body);
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Sitemap: https://ogabassey.com/sitemap/static.xml');

    const defaultBlock = body.split('\n\n')[0] ?? '';
    expect(defaultBlock).toContain('User-Agent: *');
    expect(defaultBlock).not.toContain('Disallow: /compare/');
    expect(defaultBlock).not.toContain('Disallow: /*/compare');

    for (const bot of [
      'Bytespider',
      'ClaudeBot',
      'GPTBot',
      'CCBot',
      'PetalBot',
      'SemrushBot',
      'AhrefsBot',
      'MJ12bot',
      'DotBot',
    ]) {
      const botBlock = body
        .split('\n\n')
        .find((block) => block.startsWith(`User-Agent: ${bot}\n`));
      expect(botBlock).toBeDefined();
      expect(botBlock).toContain('Allow: /');
      expect(botBlock).toContain('Disallow: /compare/');
      expect(botBlock).toContain('Disallow: /*/compare\n');
      expect(botBlock).toContain('Disallow: /*/compare/*');
    }
  });

  it('returns a safe fallback when the robots provider fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.doMock('@/app/robots', () => ({
      default: vi.fn(() => Promise.reject(new Error('robots failed'))),
    }));

    try {
      const { GET } = await import('./route');
      const response = await GET();
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('cache-control')).toBe(
        'public, max-age=300, s-maxage=300'
      );
      expect(body).toContain('User-Agent: *');
      expectStandardsOnlyRobots(body);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('serializes minimal configs without a sitemap', async () => {
    vi.doMock('@/app/robots', () => ({
      default: vi.fn(async () => ({
        rules: {
          userAgent: '*',
          allow: '/',
          disallow: '/private/',
        },
      })),
    }));

    const { GET } = await import('./route');
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('User-Agent: *');
    expectStandardsOnlyRobots(body);
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /private/');
    expect(body).not.toContain('Sitemap:');
  });

  it('omits unsupported host and crawl-delay records from robots.txt', async () => {
    vi.resetModules();
    vi.doMock('@/app/robots', () => ({
      default: vi.fn(async () => ({
        host: 'ogabassey.com',
        rules: {
          userAgent: '*',
          allow: '/',
          crawlDelay: 5,
        },
        sitemap: 'https://ogabassey.com/sitemap.xml',
      })),
    }));

    const { GET } = await import('./route');
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://ogabassey.com/sitemap.xml');
    expectStandardsOnlyRobots(body);
  });
});
