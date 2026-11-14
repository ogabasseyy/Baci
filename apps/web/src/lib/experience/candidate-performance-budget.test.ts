import { describe, expect, it } from 'vitest';
import {
  assertCandidatePerformanceBudget,
  CandidatePerformanceBudgetError,
  EXPERIENCE_STARTER_PERFORMANCE_BUDGET,
} from './candidate-performance-budget';

const base = {
  javascript: 'x',
  css: 'x',
  assets: [] as Array<{
    mime: 'image/png' | 'font/woff2';
    bytesBase64: string;
  }>,
};

const bytes = (size: number) => Buffer.alloc(size, 1).toString('base64');

describe('candidate performance budget', () => {
  it('accepts candidates at each fixed starter limit', () => {
    expect(() =>
      assertCandidatePerformanceBudget({
        javascript: 'x'.repeat(
          EXPERIENCE_STARTER_PERFORMANCE_BUDGET.javascriptBytes
        ),
        css: 'x'.repeat(EXPERIENCE_STARTER_PERFORMANCE_BUDGET.cssBytes),
        ssrHtml: 'x'.repeat(EXPERIENCE_STARTER_PERFORMANCE_BUDGET.htmlBytes),
        assets: [
          { mime: 'image/png', bytesBase64: bytes(262144) },
          { mime: 'font/woff2', bytesBase64: bytes(131072) },
        ],
      })
    ).not.toThrow();
  });

  it.each([
    ['javascript', { ...base, javascript: 'x'.repeat(262145) }],
    ['css', { ...base, css: 'x'.repeat(32769) }],
    ['ssr-html', { ...base, ssrHtml: 'x'.repeat(131073) }],
    [
      'png-asset',
      {
        ...base,
        assets: [{ mime: 'image/png' as const, bytesBase64: bytes(262145) }],
      },
    ],
    [
      'font-asset',
      {
        ...base,
        assets: [{ mime: 'font/woff2' as const, bytesBase64: bytes(131073) }],
      },
    ],
  ] as const)('rejects an over-limit %s resource without source details', (resource, input) => {
    try {
      assertCandidatePerformanceBudget(input);
      throw new Error('expected budget failure');
    } catch (error) {
      expect(error).toBeInstanceOf(CandidatePerformanceBudgetError);
      expect(error).toMatchObject({
        code: 'PERFORMANCE_BUDGET_EXCEEDED',
        resource,
      });
      expect((error as Error).message).toBe(
        `PERFORMANCE_BUDGET_EXCEEDED:${resource}`
      );
      expect((error as Error).message).not.toContain('x'.repeat(16));
    }
  });

  it('allows many individually bounded assets without an aggregate budget', () => {
    expect(() =>
      assertCandidatePerformanceBudget({
        ...base,
        assets: Array.from({ length: 20 }, () => ({
          mime: 'image/png' as const,
          bytesBase64: bytes(262144),
        })),
      })
    ).not.toThrow();
  });
});
