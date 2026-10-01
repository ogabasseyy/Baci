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

describe('bugfix: USD currency and billing evidence reuse', () => {
  it('rejects non-USD BillingCurrency on target-project rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-currency-'));
    roots.push(root);
    const path = join(root, 'eur.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'EUR',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
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
    ).rejects.toThrow('billing row has a non-USD BillingCurrency');
  });

  it('rejects reused before/after billing export evidence', async () => {
    const { beforePath, beforeDbTracePath, afterDbTracePath } =
      await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: beforePath,
          window: {
            dbTracePath: afterDbTracePath,
            deploymentSha: MEASUREMENT_AFTER_SHA,
            label: 'after',
          },
        },
        before: {
          inputPath: beforePath,
          window: {
            dbTracePath: beforeDbTracePath,
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'before',
          },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'before and after billing exports must not reuse the same evidence'
    );
  });

  it('rejects target-project rows outside the requested billing window', async () => {
    const { beforePath } = await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: beforePath,
          window: {
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'before',
            requestedWindowEnd: '2026-07-31T00:00:00.000Z',
            requestedWindowStart: '2026-07-01T00:00:00.000Z',
          },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'billing row ChargePeriod falls outside the requested window'
    );
  });

  it('rejects reused before/after DB trace evidence', async () => {
    const { beforePath, afterPath, beforeDbTracePath } =
      await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: afterPath,
          window: {
            dbTracePath: beforeDbTracePath,
            deploymentSha: MEASUREMENT_AFTER_SHA,
            label: 'after',
          },
        },
        before: {
          inputPath: beforePath,
          window: {
            dbTracePath: beforeDbTracePath,
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'before',
          },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow(
      'before and after DB traces must not reuse the same evidence'
    );
  });

  it('rejects present non-string ProjectId tags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-projectid-'));
    roots.push(root);
    const path = join(root, 'bad-tag.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 1,
        ConsumedUnit: 'Count',
        EffectiveCost: 1,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 9,
        ConsumedUnit: 'Count',
        EffectiveCost: 9,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: 42 },
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
    ).rejects.toThrow('billing row has a non-string ProjectId tag');
  });
});
