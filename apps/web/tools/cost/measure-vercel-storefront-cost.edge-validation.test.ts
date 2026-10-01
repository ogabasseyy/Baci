import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('measureVercelStorefrontCost input edge validation', () => {
  it('bugfix: rejects timezone-less billing timestamps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-tz-'));
    roots.push(root);
    const invalidPath = join(root, 'tz.jsonl');
    await writeFile(
      invalidPath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00',
        ChargePeriodEnd: '2026-08-02T00:00:00',
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
          inputPath: invalidPath,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('billing row has an invalid ChargePeriodStart');
  });

  it('bugfix: ignores prototype-polluting ServiceName values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-proto-'));
    roots.push(root);
    const path = join(root, 'proto.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 1,
        EffectiveCost: 1,
        ServiceName: 'constructor',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 2,
        ConsumedUnit: 'Count',
        EffectiveCost: 2,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    const result = await measureVercelStorefrontCost({
      before: {
        inputPath: path,
        window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.before.metrics.projectEffectiveCostUsd).toBe(3);
    expect(result.before.metrics.services.functionInvocations).toBe(2);
    expect(result.before.metrics.services).not.toHaveProperty('constructor');
  });

  it('bugfix: rejects comparisons with unequal requested window durations', async () => {
    const { afterPath, beforePath } =
      await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: afterPath,
          window: {
            deploymentSha: MEASUREMENT_AFTER_SHA,
            label: 'after',
            requestedWindowEnd: '2026-08-08T00:00:00.000Z',
            requestedWindowStart: '2026-08-01T00:00:00.000Z',
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
      'before and after measurement windows must have equal durations'
    );
  });

  it('bugfix: rejects identical before/after deployment SHAs', async () => {
    const { afterPath, beforePath } =
      await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: afterPath,
          window: {
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'after',
          },
        },
        before: {
          inputPath: beforePath,
          window: {
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'before',
          },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'before and after measurement windows must use different deployment SHAs'
    );
  });
});
