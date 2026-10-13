import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { measureVercelStorefrontCost } from './measure-vercel-storefront-cost';
import {
  createMeasurementFixtureFiles,
  MEASUREMENT_AFTER_SHA,
  MEASUREMENT_BEFORE_SHA,
  MEASUREMENT_PROJECT_ID,
} from './measure-vercel-storefront-cost.test-support';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('measureVercelStorefrontCost comparisons', () => {
  it('filters the project, aggregates billable services, and compares cache probes', async () => {
    const {
      afterCachePath,
      afterDbTracePath,
      afterPath,
      beforeDbTracePath,
      beforePath,
      cachePath,
    } = await createMeasurementFixtureFiles(roots);

    const result = await measureVercelStorefrontCost({
      after: {
        inputPath: afterPath,
        window: {
          dbTracePath: afterDbTracePath,
          cacheProbePath: afterCachePath,
          deploymentSha: MEASUREMENT_AFTER_SHA,
          label: 'after',
          requestedWindowEnd: '2026-08-03T00:00:00.000Z',
          requestedWindowStart: '2026-08-02T00:00:00.000Z',
        },
      },
      before: {
        inputPath: beforePath,
        window: {
          cacheProbePath: cachePath,
          dbTracePath: beforeDbTracePath,
          deploymentSha: MEASUREMENT_BEFORE_SHA,
          label: 'before',
          requestedWindowEnd: '2026-08-02T00:00:00.000Z',
          requestedWindowStart: '2026-08-01T00:00:00.000Z',
        },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.before.ignoredRows).toBe(1);
    expect(result.comparisonStatus).toBe('complete');
    expect(result.before.metrics.projectEffectiveCostUsd).toBe(3.5);
    expect(result.before.metrics.services.fluidActiveCpuHours).toBe(10);
    expect(result.before.metrics.services.functionInvocations).toBe(100);
    expect(result.before.cacheProbe).toMatchObject({
      cacheStatusRows: 4,
      cacheHitRows: 3,
      cacheHitRatio: 3 / 4,
      p50TtfbMs: 18,
      p95TtfbMs: 40,
    });
    expect(result.before.dbTrace).toMatchObject({
      dbCalls: 6,
      dbCallsPerRequest: 3,
      dbTimeouts: 1,
      byCohort: {
        pdp: { dbCalls: 4, dbTimeouts: 1, rows: 1 },
      },
    });
    expect(result.comparison?.projectEffectiveCostUsd).toEqual({
      absoluteDelta: -2.1,
      after: 1.4,
      before: 3.5,
      relativeChangePct: -60,
    });
    expect(result.comparison?.functionInvocations.absoluteDelta).toBe(-60);
    expect(result.comparison).not.toHaveProperty('cacheStatusRows');
    expect(result.comparison).not.toHaveProperty('cacheHitRows');
    expect(result.comparison?.cacheHitRatio).toEqual({
      absoluteDelta: -0.25,
      after: 0.5,
      before: 0.75,
      relativeChangePct: -33.333333,
    });
    expect(result.comparison?.dbCalls).toEqual({
      absoluteDelta: -4,
      after: 2,
      before: 6,
      relativeChangePct: -66.666667,
    });
    expect(result.comparison?.dbTimeouts).toEqual({
      absoluteDelta: -1,
      after: 0,
      before: 1,
      relativeChangePct: -100,
    });
  });

  it('does not claim savings when no after window is supplied', async () => {
    const { beforePath } = await createMeasurementFixtureFiles(roots);
    const result = await measureVercelStorefrontCost({
      before: {
        inputPath: beforePath,
        window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.after).toBeNull();
    expect(result.comparisonStatus).toBe('not_available');
    expect(result.comparison).toBeNull();
    expect(result.limitations).toContain(
      'No after window was supplied, so no before/after savings claim is produced.'
    );
    expect(result.limitations).toContain(
      'Comparison is incomplete without both before and after DB traces; Vercel billing exports do not contain database-call counts. Provide bounded DB trace JSONL inputs or collect the same fields from Supabase telemetry.'
    );
  });

  it.each([
    ['before-only', true, false],
    ['after-only', false, true],
  ] as const)('marks an asymmetric %s DB trace comparison incomplete without DB deltas', async (_label, includeBeforeTrace, includeAfterTrace) => {
    const { afterPath, beforePath, beforeDbTracePath, afterDbTracePath } =
      await createMeasurementFixtureFiles(roots);
    const result = await measureVercelStorefrontCost({
      after: {
        inputPath: afterPath,
        window: {
          dbTracePath: includeAfterTrace ? afterDbTracePath : undefined,
          deploymentSha: MEASUREMENT_AFTER_SHA,
          label: 'after',
        },
      },
      before: {
        inputPath: beforePath,
        window: {
          dbTracePath: includeBeforeTrace ? beforeDbTracePath : undefined,
          deploymentSha: MEASUREMENT_BEFORE_SHA,
          label: 'before',
        },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.comparisonStatus).toBe('incomplete');
    expect(result.comparison).not.toHaveProperty('dbCalls');
    expect(result.limitations).toContain(
      'Comparison is incomplete without both before and after DB traces; Vercel billing exports do not contain database-call counts. Provide bounded DB trace JSONL inputs or collect the same fields from Supabase telemetry.'
    );
  });
});
