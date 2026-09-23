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

describe('bugfix: ConsumedUnit and overlapping windows', () => {
  it('rejects Function Duration quantities expressed in the wrong unit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-unit-'));
    roots.push(root);
    const path = join(root, 'bad-unit.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 3600,
        ConsumedUnit: 'GB-Seconds',
        EffectiveCost: 1,
        ServiceName: 'Function Duration',
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
      'billing row has an unexpected ConsumedUnit for Function Duration'
    );
  });

  it('rejects equal-duration overlapping before/after charge periods', async () => {
    const { beforePath } = await createMeasurementFixtureFiles(roots);
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-overlap-'));
    roots.push(root);
    const afterPath = join(root, 'after-overlap.jsonl');
    // Distinct bytes but same Aug 1-2 window as the before fixture.
    await writeFile(
      afterPath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 1,
        ConsumedUnit: 'Count',
        EffectiveCost: 0.5,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: afterPath,
          window: { deploymentSha: MEASUREMENT_AFTER_SHA, label: 'after' },
        },
        before: {
          inputPath: beforePath,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('before and after measurement windows must not overlap');
  });
});
