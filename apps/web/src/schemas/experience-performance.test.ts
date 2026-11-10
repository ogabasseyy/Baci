import { describe, expect, it } from 'vitest';
import { experiencePerformanceReport } from './experience-performance';

const report = () => ({
  format: 'baci.performance-lab/v1',
  buildDigest: 'a'.repeat(64),
  sourceDigest: 'b'.repeat(64),
  measuredAt: '2026-10-28T12:00:00.000Z',
  renderer: 'client',
  environment: 'local-synthetic',
  cwvQualified: false,
  releaseQualified: false,
  contaminated: false,
  browser: 'Chromium test',
  samples: [
    {
      width: 390,
      cache: 'cold-context',
      route: '/',
      frameLcpMs: null,
      hostLcpMs: 120,
      frameCls: 0,
      hostCls: 0,
      interactionDurationMs: null,
      contentVisible: true,
      imagesDecoded: true,
      consoleErrors: 0,
    },
  ],
});

describe('experience performance report schema', () => {
  it('accepts honest local lab diagnostics with nullable measurements', () => {
    expect(experiencePerformanceReport.parse(report())).toMatchObject({
      environment: 'local-synthetic',
      cwvQualified: false,
      samples: [{ frameLcpMs: null }],
    });
  });

  it.each([
    { cwvQualified: true },
    { environment: 'production' },
    { unexpected: 'extra' },
  ])('rejects altered authority or unknown fields: %o', (override) => {
    expect(
      experiencePerformanceReport.safeParse({ ...report(), ...override })
        .success
    ).toBe(false);
  });
});
