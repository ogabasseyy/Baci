import { describe, expect, it } from 'vitest';
import {
  getDebugBearCategoryScore,
  getDebugBearMetric,
  getDebugBearQuickTestId,
  getDebugBearQuickTestPollPath,
  getFirstDebugBearQuickTest,
} from './debugbear-quick-test-utils.mjs';

describe('getFirstDebugBearQuickTest', () => {
  it('returns null for missing DebugBear response bodies', () => {
    expect(getFirstDebugBearQuickTest(null)).toBeNull();
    expect(getFirstDebugBearQuickTest(undefined)).toBeNull();
  });

  it('returns the first quick test from the quickTests array', () => {
    const quickTest = { id: '872' };

    expect(getFirstDebugBearQuickTest({ quickTests: [quickTest] })).toBe(
      quickTest
    );
  });

  it('returns the first item when multiple quick tests are present', () => {
    const first = { id: '872' };
    const second = { id: '873' };

    expect(getFirstDebugBearQuickTest({ quickTests: [first, second] })).toBe(
      first
    );
  });

  it('returns null for empty quickTests arrays', () => {
    expect(getFirstDebugBearQuickTest({ quickTests: [] })).toBeNull();
  });

  it('returns the first quick test from supported alternate response shapes', () => {
    const arrayQuickTest = { id: '872' };
    const testsQuickTest = { id: '873' };

    expect(getFirstDebugBearQuickTest([arrayQuickTest])).toBe(arrayQuickTest);
    expect(getFirstDebugBearQuickTest({ tests: [testsQuickTest] })).toBe(
      testsQuickTest
    );
  });
});

describe('getDebugBearQuickTestId', () => {
  it('extracts the supported quick test identifier fields', () => {
    expect(getDebugBearQuickTestId({ id: '872' })).toBe('872');
    expect(getDebugBearQuickTestId({ quickTestId: '873' })).toBe('873');
    expect(getDebugBearQuickTestId({ testId: '874' })).toBe('874');
    expect(getDebugBearQuickTestId({ resultId: '875' })).toBe('875');
  });

  it('prefers the highest-priority quick test identifier field', () => {
    expect(
      getDebugBearQuickTestId({
        id: '872',
        quickTestId: '873',
        testId: '874',
        resultId: '875',
      })
    ).toBe('872');
  });

  it('extracts identifiers from wrapped DebugBear quick test responses', () => {
    expect(getDebugBearQuickTestId({ quickTests: [{ id: '872' }] })).toBe(
      '872'
    );
    expect(getDebugBearQuickTestId({ tests: [{ id: '873' }] })).toBe('873');
  });

  it('returns null for missing or malformed DebugBear response bodies', () => {
    expect(getDebugBearQuickTestId(null)).toBeNull();
    expect(getDebugBearQuickTestId(undefined)).toBeNull();
    expect(getDebugBearQuickTestId({ quickTests: [] })).toBeNull();
    expect(getDebugBearQuickTestId({})).toBeNull();
  });
});

describe('getDebugBearQuickTestPollPath', () => {
  it('uses explicit DebugBear API poll links when they are present', () => {
    expect(
      getDebugBearQuickTestPollPath({
        body: {
          quickTests: [
            {
              apiUrl:
                'https://www.debugbear.com/api/v1/project/101919/quickTest/872',
            },
          ],
        },
        projectId: '101919',
        quickTestId: '872',
      })
    ).toBe('/project/101919/quickTest/872');
  });

  it('falls back to the project-scoped quick test endpoint when DebugBear omits poll links', () => {
    expect(
      getDebugBearQuickTestPollPath({
        body: {
          quickTests: [
            {
              hasFinished: false,
              id: '872',
              resultUrl:
                'https://www.debugbear.com/project/101919/quickTest/tgmOCvxLiiA0O5DtysxDcZ8q4/overview',
            },
          ],
        },
        projectId: '101919',
        quickTestId: '872',
      })
    ).toBe('/project/101919/quickTest/872');
  });

  it('falls back to the project-scoped endpoint when DebugBear returns a malformed poll link', () => {
    expect(
      getDebugBearQuickTestPollPath({
        body: {
          quickTests: [
            {
              apiUrl: 'https://[',
              id: '872',
            },
          ],
        },
        projectId: '101919',
        quickTestId: '872',
      })
    ).toBe('/project/101919/quickTest/872');
  });

  it('falls back to the project-scoped endpoint when a poll link uses an unexpected host', () => {
    expect(
      getDebugBearQuickTestPollPath({
        body: {
          quickTests: [
            {
              apiUrl: 'https://example.com/api/v1/project/101919/quickTest/872',
              id: '999',
            },
          ],
        },
        projectId: '101919',
        quickTestId: '999',
      })
    ).toBe('/project/101919/quickTest/999');
  });

  it('throws a clear error when no poll link or quick test id is available', () => {
    expect(() =>
      getDebugBearQuickTestPollPath({
        body: {},
        projectId: '101919',
        quickTestId: undefined,
      })
    ).toThrow('Missing DebugBear quick test id');
  });
});

describe('getDebugBearMetric', () => {
  it('preserves zero-valued DebugBear metrics', () => {
    expect(
      getDebugBearMetric(
        { metrics: { 'performance.cumulativeLayoutShift': 0 } },
        ['performance.cumulativeLayoutShift']
      )
    ).toBe(0);
  });

  it('falls through supported metric containers without dropping later values', () => {
    expect(
      getDebugBearMetric(
        {
          lighthouseResult: {
            audits: {
              'largest-contentful-paint': { numericValue: 1431 },
            },
          },
        },
        ['performance.largestContentfulPaint', 'largest-contentful-paint']
      )
    ).toBe(1431);
  });

  it('returns null when the metric is not found in any location', () => {
    expect(
      getDebugBearMetric({ metrics: { 'other.metric': 123 } }, [
        'performance.largestContentfulPaint',
        'largest-contentful-paint',
      ])
    ).toBeNull();
  });

  it('throws a clear error when metric names are not an array', () => {
    expect(() => getDebugBearMetric({ metrics: {} }, 'lcp')).toThrow(
      'names must be an array of metric names'
    );
  });
});

describe('getDebugBearCategoryScore', () => {
  it('normalizes Lighthouse-style category scores to percentages', () => {
    expect(
      getDebugBearCategoryScore(
        { lighthouseResult: { categories: { performance: { score: 0.91 } } } },
        ['performance']
      )
    ).toBe(91);
  });

  it('normalizes DebugBear metrics-backed category scores to percentages', () => {
    expect(
      getDebugBearCategoryScore({ metrics: { 'performance.score': 0.88 } }, [
        'performance',
      ])
    ).toBe(88);
  });

  it('normalizes DebugBear summary-backed category scores to percentages', () => {
    expect(
      getDebugBearCategoryScore({ summary: { 'performance.score': 0.73 } }, [
        'performance',
      ])
    ).toBe(73);
  });

  it('returns null when DebugBear does not include category scores', () => {
    expect(
      getDebugBearCategoryScore({ metrics: {} }, ['performance'])
    ).toBeNull();
  });
});
