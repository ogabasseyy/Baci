import { afterEach, describe, expect, it } from 'vitest';
import { rateLimitDiagnostics } from './rate-limit-diagnostics';

afterEach(() => {
  rateLimitDiagnostics.reset();
});

describe('rate-limit diagnostics', () => {
  it('reports fixed-cardinality backend outcomes to the installed sink', () => {
    const diagnostics: unknown[] = [];
    rateLimitDiagnostics.setHook((diagnostic) => diagnostics.push(diagnostic));

    rateLimitDiagnostics.report({
      backend: 'memory',
      reason: 'redis_unavailable',
    });

    expect(diagnostics).toEqual([
      { backend: 'memory', reason: 'redis_unavailable' },
    ]);
  });

  it('swallows synchronous sink failures', () => {
    rateLimitDiagnostics.setHook(() => {
      throw new Error('diagnostic sink unavailable');
    });

    expect(() =>
      rateLimitDiagnostics.report({
        backend: 'redis',
        reason: 'redis_success',
      })
    ).not.toThrow();
  });

  it('swallows rejected asynchronous sink failures', async () => {
    rateLimitDiagnostics.setHook(async () => {
      throw new Error('diagnostic sink unavailable');
    });

    await expect(
      rateLimitDiagnostics.report({
        backend: 'redis',
        reason: 'redis_error',
      })
    ).resolves.toBeUndefined();
  });
});
