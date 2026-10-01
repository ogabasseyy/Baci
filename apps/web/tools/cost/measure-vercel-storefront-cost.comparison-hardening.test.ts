import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe('measureVercelStorefrontCost comparison hardening', () => {
  it('bugfix: requires requested windows on both sides or neither', async () => {
    const { afterPath, beforePath } =
      await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: afterPath,
          window: {
            deploymentSha: MEASUREMENT_AFTER_SHA,
            label: 'after',
          },
        },
        before: {
          inputPath: beforePath,
          window: {
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'before',
            requestedWindowEnd: '2026-08-02T00:00:00.000Z',
            requestedWindowStart: '2026-08-01T00:00:00.000Z',
          },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'before and after measurement windows must both supply requested windows or neither'
    );
  });

  it('bugfix: suppresses relative percentages for non-positive cost baselines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-neg-base-'));
    roots.push(root);
    const beforePath = join(root, 'before.jsonl');
    const afterPath = join(root, 'after.jsonl');
    await writeFile(
      beforePath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 0,
        ConsumedUnit: 'Count',
        EffectiveCost: -1,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );
    await writeFile(
      afterPath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-02T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-03T00:00:00.000Z',
        ConsumedQuantity: 0,
        ConsumedUnit: 'Count',
        EffectiveCost: 0,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    const result = await measureVercelStorefrontCost({
      after: {
        inputPath: afterPath,
        window: { deploymentSha: MEASUREMENT_AFTER_SHA, label: 'after' },
      },
      before: {
        inputPath: beforePath,
        window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.comparison?.projectEffectiveCostUsd).toEqual({
      absoluteDelta: 1,
      after: 0,
      before: -1,
      relativeChangePct: null,
    });
  });

  it('bugfix: rejects EffectiveCost totals outside the safe integer range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-overflow-'));
    roots.push(root);
    const path = join(root, 'overflow.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-02T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-03T00:00:00.000Z',
        ConsumedQuantity: 0,
        ConsumedUnit: 'Count',
        EffectiveCost: Number.MAX_SAFE_INTEGER,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 0,
        ConsumedUnit: 'Count',
        EffectiveCost: 2,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: path,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'billing export EffectiveCost total is out of safe range'
    );
  });

  it('bugfix: rejects per-service quantity totals outside the safe integer range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-qty-overflow-'));
    roots.push(root);
    const path = join(root, 'qty-overflow.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: Number.MAX_SAFE_INTEGER,
        ConsumedUnit: 'Count',
        EffectiveCost: 0,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 2,
        ConsumedUnit: 'Count',
        EffectiveCost: 0,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: path,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'billing export functionInvocations total is out of safe range'
    );
  });

  it('bugfix: rejects impossible calendar dates instead of normalizing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-bad-date-'));
    roots.push(root);
    const path = join(root, 'bad-date.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-02-31T00:00:00Z',
        ChargePeriodEnd: '2026-03-01T00:00:00Z',
        ConsumedQuantity: 1,
        ConsumedUnit: 'Count',
        EffectiveCost: 1,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: path,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('billing row has an invalid ChargePeriodStart');
  });

  it('bugfix: marks mismatched DB cohort samples incomplete and suppresses DB deltas', async () => {
    const { afterPath, beforePath, root } =
      await createMeasurementFixtureFiles(roots);
    const beforeDbTracePath = join(root, 'before-mismatch-db.jsonl');
    const afterDbTracePath = join(root, 'after-mismatch-db.jsonl');
    await writeFile(
      beforeDbTracePath,
      `${JSON.stringify({ cohort: 'pdp', dbCalls: 4, dbTimeouts: 0 })}\n`
    );
    await writeFile(
      afterDbTracePath,
      `${JSON.stringify({ cohort: 'blog', dbCalls: 1, dbTimeouts: 0 })}\n${JSON.stringify({ cohort: 'blog', dbCalls: 1, dbTimeouts: 0 })}\n`
    );

    const result = await measureVercelStorefrontCost({
      after: {
        inputPath: afterPath,
        window: {
          deploymentSha: MEASUREMENT_AFTER_SHA,
          dbTracePath: afterDbTracePath,
          label: 'after',
        },
      },
      before: {
        inputPath: beforePath,
        window: {
          deploymentSha: MEASUREMENT_BEFORE_SHA,
          dbTracePath: beforeDbTracePath,
          label: 'before',
        },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.comparisonStatus).toBe('incomplete');
    expect(result.comparison?.dbCalls).toBeUndefined();
    expect(result.limitations).toContain(
      'Comparison is incomplete because before and after DB traces do not share matching per-cohort sample sizes; raw DB totals are suppressed until comparable route samples are supplied.'
    );
  });

  it('bugfix: marks reversed cohort mix incomplete even when totals match', async () => {
    const { afterPath, beforePath, root } =
      await createMeasurementFixtureFiles(roots);
    const beforeDbTracePath = join(root, 'before-mix-db.jsonl');
    const afterDbTracePath = join(root, 'after-mix-db.jsonl');
    const beforeRows = [
      ...Array.from({ length: 99 }, () =>
        JSON.stringify({ cohort: 'pdp', dbCalls: 1, dbTimeouts: 0 })
      ),
      JSON.stringify({ cohort: 'blog', dbCalls: 1, dbTimeouts: 0 }),
    ];
    const afterRows = [
      JSON.stringify({ cohort: 'pdp', dbCalls: 1, dbTimeouts: 0 }),
      ...Array.from({ length: 99 }, () =>
        JSON.stringify({ cohort: 'blog', dbCalls: 1, dbTimeouts: 0 })
      ),
    ];
    await writeFile(beforeDbTracePath, `${beforeRows.join('\n')}\n`);
    await writeFile(afterDbTracePath, `${afterRows.join('\n')}\n`);

    const result = await measureVercelStorefrontCost({
      after: {
        inputPath: afterPath,
        window: {
          deploymentSha: MEASUREMENT_AFTER_SHA,
          dbTracePath: afterDbTracePath,
          label: 'after',
        },
      },
      before: {
        inputPath: beforePath,
        window: {
          deploymentSha: MEASUREMENT_BEFORE_SHA,
          dbTracePath: beforeDbTracePath,
          label: 'before',
        },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.comparisonStatus).toBe('incomplete');
    expect(result.comparison?.dbCalls).toBeUndefined();
    expect(result.limitations).toContain(
      'Comparison is incomplete because before and after DB traces do not share matching per-cohort sample sizes; raw DB totals are suppressed until comparable route samples are supplied.'
    );
  });
});
