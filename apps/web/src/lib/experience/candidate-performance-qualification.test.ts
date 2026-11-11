import { describe, expect, it } from 'vitest';
import { experienceCanonicalRoutePathSchema } from '@/schemas/experience-route-path';
import {
  assertCandidatePerformanceQualification,
  type CandidatePerformanceQualificationError,
  EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY,
} from './candidate-performance-qualification';

const expected = {
  buildDigest: 'a'.repeat(64),
  sourceDigest: 'b'.repeat(64),
  renderer: 'prerender' as const,
  routes: ['/', '/collections/all'],
  bootstrapDigests: [
    { route: '/', digest: 'c'.repeat(64) },
    { route: '/collections/all', digest: 'd'.repeat(64) },
  ],
};

function report(
  overrides: {
    report?: Record<string, unknown>;
    sample?: (
      sample: Record<string, unknown>,
      index: number
    ) => Record<string, unknown>;
  } = {}
) {
  const samples = expected.routes.flatMap((route) =>
    [390, 1440].flatMap((width) =>
      Array.from({ length: 3 }, () => ({
        width,
        cache: 'cold-context',
        route,
        frameLcpMs: 1800,
        hostLcpMs: 1900,
        frameCls: 0.05,
        hostCls: 0.04,
        interactionDurationMs: null,
        contentVisible: true,
        imagesDecoded: true,
        consoleErrors: 0,
      }))
    )
  );
  return {
    format: 'baci.performance-lab/v1',
    buildDigest: expected.buildDigest,
    sourceDigest: expected.sourceDigest,
    measuredAt: '2026-10-26T12:00:00.000Z',
    renderer: expected.renderer,
    environment: 'local-synthetic',
    cwvQualified: false,
    releaseQualified: false,
    contaminated: false,
    browser: '142.0.7444.0',
    bootstrapDigests: expected.bootstrapDigests,
    samples: samples.map(
      (sample, index) => overrides.sample?.(sample, index) ?? sample
    ),
    ...overrides.report,
  };
}

function expectUnqualified(
  input: unknown,
  reason: CandidatePerformanceQualificationError['reason']
) {
  expect(() =>
    assertCandidatePerformanceQualification(input, expected)
  ).toThrowError(
    expect.objectContaining({
      code: 'PERFORMANCE_NOT_QUALIFIED',
      reason,
    })
  );
}

describe('candidate performance qualification', () => {
  it('accepts the complete clean route and viewport matrix without elevating CWV claims', () => {
    const result = assertCandidatePerformanceQualification(report(), expected);

    expect(EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY).toEqual({
      id: 'chromium-native-reference/v1',
      widths: [390, 1440],
      coldSamplesPerCell: 3,
      lcpTargetMs: 2000,
      maxCls: 0.1,
    });
    expect(result).toMatchObject({
      policyId: 'chromium-native-reference/v1',
      buildDigest: expected.buildDigest,
      sourceDigest: expected.sourceDigest,
      sampleCount: 12,
      routeCount: 2,
      cwvQualified: false,
      releaseQualified: false,
    });
    expect(result.report.cwvQualified).toBe(false);
  });

  it('accepts the full 240-character single-slash route contract', () => {
    const route = `/${'r'.repeat(239)}`;
    const bootstrapDigests = [{ route, digest: 'e'.repeat(64) }];
    const input = report({
      report: {
        bootstrapDigests,
        samples: report()
          .samples.slice(0, 6)
          .map((sample) => ({
            ...sample,
            route,
          })),
      },
    });

    expect(
      assertCandidatePerformanceQualification(input, {
        ...expected,
        routes: [route],
        bootstrapDigests,
      })
    ).toMatchObject({ routeCount: 1, sampleCount: 6 });
  });

  it.each([
    `/${'r'.repeat(240)}`,
    '//double',
  ])('rejects a route outside the shared single-slash 1–240 character contract: %s', (route) => {
    expect(experienceCanonicalRoutePathSchema.safeParse(route).success).toBe(
      false
    );
  });

  it('rejects untrusted flags, schema extras, contamination, or mismatched binding', () => {
    expectUnqualified(
      report({ report: { cwvQualified: true } }),
      'invalid-report'
    );
    expectUnqualified(
      report({ report: { unexpected: 'pass' } }),
      'invalid-report'
    );
    expectUnqualified(
      report({ report: { contaminated: true } }),
      'contaminated'
    );
    expectUnqualified(
      report({ report: { buildDigest: 'c'.repeat(64) } }),
      'binding-mismatch'
    );
    expectUnqualified(
      report({ report: { renderer: 'client' } }),
      'renderer-mismatch'
    );
  });

  it('requires exact current public-data fingerprints for every route', () => {
    const legacy = report();
    delete (legacy as { bootstrapDigests?: unknown }).bootstrapDigests;
    expectUnqualified(legacy, 'data-binding-mismatch');
    expectUnqualified(
      report({
        report: {
          bootstrapDigests: [
            { route: '/', digest: 'c'.repeat(64) },
            { route: '/collections/all', digest: 'e'.repeat(64) },
          ],
        },
      }),
      'data-binding-mismatch'
    );
  });

  it('rejects missing, extra, and incorrectly sampled route-width cells', () => {
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, route: '/' }) }),
      'route-matrix-mismatch'
    );
    expectUnqualified(
      report({ report: { samples: report().samples.slice(1) } }),
      'route-matrix-mismatch'
    );
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, width: 768 }) }),
      'invalid-report'
    );
  });

  it('rejects missing required metrics and failed render/readiness checks', () => {
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, frameLcpMs: null }) }),
      'missing-metrics'
    );
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, hostCls: null }) }),
      'missing-metrics'
    );
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, contentVisible: false }) }),
      'content-not-ready'
    );
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, imagesDecoded: false }) }),
      'content-not-ready'
    );
    expectUnqualified(
      report({ sample: (sample) => ({ ...sample, consoleErrors: 1 }) }),
      'content-not-ready'
    );
  });

  it('uses per-cell median LCP and requires every host/frame CLS sample to pass', () => {
    const medianFailure = report({
      sample: (sample, index) =>
        sample.route === '/' && sample.width === 390
          ? { ...sample, frameLcpMs: [1999, 2001, 2100][index % 3] }
          : sample,
    });
    expectUnqualified(medianFailure, 'lcp-threshold');

    expectUnqualified(
      report({
        sample: (sample, index) =>
          sample.route === '/' && sample.width === 390 && index === 0
            ? { ...sample, hostCls: 0.101 }
            : sample,
      }),
      'cls-threshold'
    );
    expectUnqualified(
      report({
        sample: (sample) => ({
          ...sample,
          frameLcpMs: 2001,
          hostLcpMs: 2000,
        }),
      }),
      'lcp-threshold'
    );
    expectUnqualified(
      report({
        sample: (sample) => ({ ...sample, frameLcpMs: 1999, hostLcpMs: 2001 }),
      }),
      'lcp-threshold'
    );
    expectUnqualified(
      report({
        sample: (sample) => ({ ...sample, frameCls: 0.101, hostCls: 0 }),
      }),
      'cls-threshold'
    );
    expect(
      assertCandidatePerformanceQualification(
        report({
          sample: (sample) => ({
            ...sample,
            frameLcpMs: 2000,
            hostLcpMs: 2000,
          }),
        }),
        expected
      ).sampleCount
    ).toBe(12);
  });

  it('records lab interaction duration without treating it as field INP', () => {
    const result = assertCandidatePerformanceQualification(
      report({
        sample: (sample) => ({ ...sample, interactionDurationMs: 5000 }),
      }),
      expected
    );
    expect(result.cwvQualified).toBe(false);
  });
});
