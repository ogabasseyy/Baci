import { expect, it, vi } from 'vitest';

const authorize = vi.hoisted(() => vi.fn(async (ctx: unknown) => ctx));
vi.mock('./authorization', () => ({ requireExperienceOwner: authorize }));

import { retainBuildPerformanceReport } from './build-performance-retention';

const binding = {
  merchantId: 'merchant',
  buildId: 'build',
  buildDigest: 'a'.repeat(64),
  sourceDigest: 'b'.repeat(64),
};
const report = {
  format: 'baci.performance-lab/v1',
  buildDigest: binding.buildDigest,
  sourceDigest: binding.sourceDigest,
  measuredAt: '2026-11-04T00:00:00Z',
  renderer: 'prerender',
  environment: 'local-synthetic',
  cwvQualified: false,
  releaseQualified: false,
  contaminated: true,
  browser: 'synthetic',
  samples: [],
} as const;
it('retains an owner-authorized exact-build report and preserves its status', async () => {
  const retain = vi.fn();
  expect(
    await retainBuildPerformanceReport(
      {} as never,
      binding,
      { status: 'failed', report: { ...report, samples: [] } },
      { retain }
    )
  ).toBe('failed');
  expect(retain).toHaveBeenCalledWith(binding, report);
});
it('cannot claim retention when a report or storage is missing, or storage fails', async () => {
  const retain = vi.fn(() => {
    throw Error('storage');
  });
  expect(
    await retainBuildPerformanceReport(
      {} as never,
      binding,
      { status: 'measured' },
      { retain }
    )
  ).toBe('not-measured');
  expect(
    await retainBuildPerformanceReport(
      {} as never,
      binding,
      { status: 'not-measured' },
      { retain }
    )
  ).toBe('not-measured');
  expect(
    await retainBuildPerformanceReport(
      {} as never,
      binding,
      { status: 'measured', report: { ...report, samples: [] } },
      undefined
    )
  ).toBe('not-measured');
  expect(
    await retainBuildPerformanceReport(
      {} as never,
      binding,
      { status: 'measured', report: { ...report, samples: [] } },
      { retain }
    )
  ).toBe('not-measured');
});
it('propagates revoked owner authorization without retaining any report', async () => {
  const retain = vi.fn();
  authorize.mockRejectedValueOnce(Error('NOT_FOUND'));
  await expect(
    retainBuildPerformanceReport(
      {} as never,
      binding,
      { status: 'measured', report: { ...report, samples: [] } },
      { retain }
    )
  ).rejects.toThrow('NOT_FOUND');
  expect(retain).not.toHaveBeenCalled();
});
