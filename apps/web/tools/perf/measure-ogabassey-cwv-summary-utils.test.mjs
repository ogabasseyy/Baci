import { afterEach, describe, expect, it, vi } from 'vitest';
import { ogabasseyCwvSummary } from './measure-ogabassey-cwv-summary-utils.mjs';

const {
  getDebugBearFailureMessage,
  getFieldMetric,
  isDebugBearComplete,
  printCwvSummaryTable,
  summarizeDebugBearResult,
  summarizePsiResult,
} = ogabasseyCwvSummary;

describe('getFieldMetric', () => {
  it('uses URL-level field data when PageSpeed returns the requested URL', () => {
    expect(
      getFieldMetric(
        {
          loadingExperience: {
            id: 'https://ogabassey.com/',
            metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3200 } },
          },
        },
        'https://ogabassey.com/',
        'LARGEST_CONTENTFUL_PAINT_MS'
      )
    ).toEqual({ category: undefined, p75: 3200, scope: 'url' });
  });

  it('honors PageSpeed origin_fallback on loadingExperience', () => {
    expect(
      getFieldMetric(
        {
          loadingExperience: {
            id: 'https://ogabassey.com/',
            origin_fallback: true,
            metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4400 } },
          },
        },
        'https://ogabassey.com/',
        'LARGEST_CONTENTFUL_PAINT_MS'
      )
    ).toEqual({ category: undefined, p75: 4400, scope: 'origin' });
  });

  it('labels origin fallback field data explicitly', () => {
    expect(
      getFieldMetric(
        {
          loadingExperience: {
            id: 'https://ogabassey.com',
            metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4400 } },
          },
          originLoadingExperience: {
            id: 'https://ogabassey.com',
            metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4500 } },
          },
        },
        'https://ogabassey.com/blog/post',
        'LARGEST_CONTENTFUL_PAINT_MS'
      )
    ).toEqual({ category: undefined, p75: 4400, scope: 'origin' });
  });

  it('does not mark origin-level homepage fallbacks as URL-level data', () => {
    expect(
      getFieldMetric(
        {
          originLoadingExperience: {
            id: 'https://ogabassey.com',
            metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4500 } },
          },
        },
        'https://ogabassey.com/',
        'LARGEST_CONTENTFUL_PAINT_MS'
      )
    ).toEqual({ category: undefined, p75: 4500, scope: 'origin' });
  });

  it('normalizes PageSpeed CLS percentiles from hundredths', () => {
    expect(
      getFieldMetric(
        {
          loadingExperience: {
            id: 'https://ogabassey.com/',
            metrics: {
              CUMULATIVE_LAYOUT_SHIFT_SCORE: {
                category: 'FAST',
                percentile: 10,
              },
            },
          },
        },
        'https://ogabassey.com/',
        'CUMULATIVE_LAYOUT_SHIFT_SCORE'
      )
    ).toEqual({ category: 'FAST', p75: 0.1, scope: 'url' });
  });
});

describe('printCwvSummaryTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses DebugBear device when strategy is absent', () => {
    const table = vi
      .spyOn(console, 'table')
      .mockImplementation(() => undefined);

    printCwvSummaryTable([
      {
        device: 'Desktop',
        label: 'home',
        source: 'debugbear',
      },
    ]);

    expect(table).toHaveBeenCalledWith([
      expect.objectContaining({ strategy: 'Desktop' }),
    ]);
  });

  it('prints PageSpeed field INP when lab INP is absent', () => {
    const table = vi
      .spyOn(console, 'table')
      .mockImplementation(() => undefined);

    printCwvSummaryTable([
      {
        fieldInp: { p75: 182, scope: 'url' },
        label: 'home',
        source: 'psi',
      },
    ]);

    expect(table).toHaveBeenCalledWith([expect.objectContaining({ inp: 182 })]);
  });
});

describe('summarizePsiResult', () => {
  it('summarizes lab, scores, and field metrics', () => {
    expect(
      summarizePsiResult({
        label: 'home',
        requestedUrl: 'https://ogabassey.com/',
        strategy: 'mobile',
        payload: {
          lighthouseResult: {
            finalUrl: 'https://ogabassey.com/',
            categories: {
              performance: { score: 0.91 },
              seo: { score: 1 },
              accessibility: { score: 0.96 },
              'best-practices': { score: 1 },
            },
            audits: {
              'first-contentful-paint': { numericValue: 1000 },
              'largest-contentful-paint': { numericValue: 3000 },
              'total-blocking-time': { numericValue: 50 },
              'cumulative-layout-shift': { numericValue: 0.01 },
              'speed-index': { numericValue: 3500 },
            },
          },
          loadingExperience: {
            id: 'https://ogabassey.com/',
            metrics: {
              INTERACTION_TO_NEXT_PAINT: { percentile: 190 },
              LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4800 },
            },
          },
        },
      })
    ).toMatchObject({
      a11y: 96,
      bp: 100,
      fieldLcp: { p75: 4800, scope: 'url' },
      inpMs: 190,
      fcpMs: 1000,
      label: 'home',
      lcpMs: 3000,
      performance: 91,
      seo: 100,
      source: 'psi',
      speedIndexMs: 3500,
      strategy: 'mobile',
      tbtMs: 50,
    });
  });
});

describe('summarizeDebugBearResult', () => {
  it('normalizes DebugBear metrics-backed scores and vitals', () => {
    expect(
      summarizeDebugBearResult({
        label: 'pdp',
        url: 'https://ogabassey.com/pdp',
        device: 'Mobile',
        projectId: '102065',
        quickTestId: '1431',
        region: 'uk',
        body: {
          resultUrl:
            'https://www.debugbear.com/project/102065/quickTest/x/overview',
          metrics: {
            'performance.score': 0.88,
            'seo.score': 1,
            'accessibility.score': 0.97,
            'bestPractices.score': 1,
            'performance.firstContentfulPaint': 1385,
            'performance.largestContentfulPaint': 2587,
            'crux.inp.p75': 171,
            'performance.totalBlockingTime': 382,
            'performance.cumulativeLayoutShift': 0,
            'performance.speedIndex': 2354,
            'console.errors': 3,
            'pageWeight.total': 768615,
          },
        },
      })
    ).toMatchObject({
      a11y: 97,
      bp: 100,
      cls: 0,
      consoleErrors: 3,
      device: 'Mobile',
      fcpMs: 1385,
      label: 'pdp',
      inpMs: 171,
      lcpMs: 2587,
      pageWeightKb: 750.6,
      performance: 88,
      projectId: '102065',
      quickTestId: '1431',
      region: 'uk',
      seo: 100,
      source: 'debugbear',
      speedIndexMs: 2354,
      tbtMs: 382,
    });
  });

  it('builds a DebugBear overview URL before falling back to the measured page URL', () => {
    expect(
      summarizeDebugBearResult({
        label: 'pdp',
        url: 'https://ogabassey.com/pdp',
        device: 'Mobile',
        projectId: '102065',
        quickTestId: '1431',
        region: 'uk',
        body: { url: 'https://ogabassey.com/pdp', metrics: {} },
      }).resultUrl
    ).toBe('https://www.debugbear.com/project/102065/quickTest/1431/overview');
  });

  it('reads URL-scoped DebugBear CrUX INP before generic INP metrics', () => {
    expect(
      summarizeDebugBearResult({
        body: {
          metrics: {
            'crux.inp.p75': 220,
            'crux.url.inp.p75': 140,
          },
        },
      }).inpMs
    ).toBe(140);
  });
});

describe('DebugBear status helpers', () => {
  it('treats documented terminal statuses as complete', () => {
    expect(isDebugBearComplete({ status: 'success' })).toBe(true);
    expect(isDebugBearComplete({ status: 'neutral' })).toBe(true);
    expect(isDebugBearComplete({ status: 'failure' })).toBe(true);
  });

  it('returns a failure message for completed failed DebugBear tests', () => {
    expect(
      getDebugBearFailureMessage({
        error: { message: 'Performance budget breached' },
        status: 'failure',
      })
    ).toBe('Performance budget breached');
  });

  it('falls back to a string message when failed DebugBear tests return structured error objects', () => {
    expect(
      getDebugBearFailureMessage({
        error: { code: 'ERR_BUDGET' },
        status: 'failure',
      })
    ).toBe('DebugBear test status was failure');
  });

  it('does not mark successful or neutral DebugBear tests as failures', () => {
    expect(getDebugBearFailureMessage({ status: 'success' })).toBeNull();
    expect(getDebugBearFailureMessage({ status: 'neutral' })).toBeNull();
  });
});
