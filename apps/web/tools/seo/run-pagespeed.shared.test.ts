import { describe, expect, it } from 'vitest';
import { pageSpeedShared } from './run-pagespeed.shared';

describe('run-pagespeed shared helpers', () => {
  it('builds platform targets and appends extra absolute urls', () => {
    expect(
      pageSpeedShared.buildPageSpeedTargets({
        baseUrl: 'https://usebaci.com',
        extraUrls: ['https://ogabassey.com'],
      })
    ).toEqual([
      { label: 'home', url: 'https://usebaci.com/' },
      { label: 'pricing', url: 'https://usebaci.com/pricing' },
      { label: 'features', url: 'https://usebaci.com/features' },
      { label: 'blog', url: 'https://usebaci.com/blog' },
      { label: 'contact', url: 'https://usebaci.com/contact' },
      { label: 'extra-1', url: 'https://ogabassey.com/' },
    ]);
  });

  it('throws for invalid extra target urls instead of silently skipping them', () => {
    expect(() =>
      pageSpeedShared.buildPageSpeedTargets({
        baseUrl: 'https://usebaci.com',
        extraUrls: ['notaurl'],
      })
    ).toThrow('Invalid PageSpeed target URL "notaurl"');
  });

  it('parses strategies and falls back to mobile when input is empty', () => {
    expect(pageSpeedShared.parseStrategies('mobile,desktop')).toEqual([
      'mobile',
      'desktop',
    ]);
    expect(pageSpeedShared.parseStrategies()).toEqual(['mobile']);
    expect(pageSpeedShared.parseStrategies(' , ')).toEqual(['mobile']);
  });

  it('throws for invalid PageSpeed strategies', () => {
    expect(() => pageSpeedShared.parseStrategies('tablet,mobile')).toThrow(
      'Invalid PageSpeed strategies: tablet. Allowed values: mobile, desktop'
    );
  });

  it('builds the PSI API url with repeated categories', () => {
    const url = new URL(
      pageSpeedShared.buildPsiUrl({
        apiKey: 'secret',
        strategy: 'mobile',
        targetUrl: 'https://usebaci.com/pricing',
      })
    );

    expect(url.origin).toBe('https://www.googleapis.com');
    expect(url.searchParams.get('url')).toBe('https://usebaci.com/pricing');
    expect(url.searchParams.get('strategy')).toBe('mobile');
    expect(url.searchParams.get('key')).toBe('secret');
    expect(url.searchParams.getAll('category')).toEqual([
      'performance',
      'accessibility',
      'best-practices',
      'seo',
    ]);
  });

  it('renders request failures with their message in the summary', () => {
    expect(
      pageSpeedShared.buildPageSpeedSummary([
        {
          label: 'home',
          url: 'https://usebaci.com/',
          strategy: 'mobile',
          passed: false,
          failures: [
            {
              metric: 'request',
              actual: null,
              threshold: 0,
              message: 'timed out',
            },
          ],
          scores: {},
          vitals: {},
        },
      ])
    ).toContain('request: timed out');
  });

  it('keeps score and threshold visible for messaged category failures', () => {
    // seo has no table column, so the diagnostic message must carry the
    // numbers or the report hides them entirely.
    expect(
      pageSpeedShared.buildPageSpeedSummary([
        {
          label: 'home',
          url: 'https://usebaci.com/',
          strategy: 'mobile',
          passed: false,
          failures: [
            {
              metric: 'seo',
              actual: 0.8,
              threshold: 0.9,
              message:
                'Failing Lighthouse audits (score 0.8, threshold 0.9): is-crawlable',
            },
          ],
          scores: {},
          vitals: {},
        },
      ])
    ).toContain(
      'seo: Failing Lighthouse audits (score 0.8, threshold 0.9): is-crawlable'
    );
  });

  it('renders every measured vital for passing and failing targets', () => {
    const summary = pageSpeedShared.buildPageSpeedSummary([
      {
        label: 'merchant-home',
        url: 'https://ogabassey.com/',
        strategy: 'mobile',
        passed: true,
        failures: [],
        scores: { performance: 0.91 },
        vitals: { lcp: 2410.4, cls: 0.0341, tbt: 100.2, inp: 180.7 },
      },
      {
        label: 'merchant-pdp',
        url: 'https://ogabassey.com/smartphones/iphone-16-pro-max',
        strategy: 'mobile',
        passed: false,
        failures: [{ metric: 'lcp', actual: 3200, threshold: 2500 }],
        scores: { performance: 0.74 },
        vitals: { lcp: 3200, cls: null, tbt: 205, inp: null },
      },
    ]);

    expect(summary).toContain(
      '| [merchant-home](https://ogabassey.com/) | mobile | PASS | 91 | 2410 ms | 0.034 | 100 ms | 181 ms |'
    );
    expect(summary).toContain(
      '| [merchant-pdp](https://ogabassey.com/smartphones/iphone-16-pro-max) | mobile | FAIL | 74 | 3200 ms | missing | 205 ms | missing |'
    );
    expect(summary).toContain('### Failures');
    expect(summary).toContain('lcp: 3200 (threshold 2500)');
  });
});
