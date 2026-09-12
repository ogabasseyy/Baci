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
import { MAX_INPUT_ROWS } from './measure-vercel-storefront-cost-types';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('measureVercelStorefrontCost validation', () => {
  it('normalizes offset billing timestamps before comparing charge periods', async () => {
    const { beforePath } = await createMeasurementFixtureFiles(roots);
    const offsetPath = beforePath.replace('before.jsonl', 'offset.jsonl');
    await writeFile(
      offsetPath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T01:00:00+01:00',
        ChargePeriodEnd: '2026-08-01T02:00:00+01:00',
        ConsumedQuantity: 1,
        ConsumedUnit: 'Count',
        EffectiveCost: 1,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:30:00Z',
        ChargePeriodEnd: '2026-08-01T01:30:00Z',
        ConsumedQuantity: 1,
        ConsumedUnit: 'Count',
        EffectiveCost: 1,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    const result = await measureVercelStorefrontCost({
      before: {
        inputPath: offsetPath,
        window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.before.observedChargePeriod).toEqual({
      end: '2026-08-01T01:30:00.000Z',
      start: '2026-08-01T00:00:00.000Z',
    });
  });

  it('rejects a half-specified before billing window', async () => {
    const { beforePath } = await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: beforePath,
          window: {
            deploymentSha: MEASUREMENT_BEFORE_SHA,
            label: 'before',
            requestedWindowStart: '2026-08-01T00:00:00.000Z',
          },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('requested billing window requires both start and end');
  });

  it('rejects a half-specified after billing window', async () => {
    const { afterPath, beforePath } =
      await createMeasurementFixtureFiles(roots);
    await expect(
      measureVercelStorefrontCost({
        after: {
          inputPath: afterPath,
          window: {
            deploymentSha: MEASUREMENT_AFTER_SHA,
            label: 'after',
            requestedWindowEnd: '2026-08-02T00:00:00.000Z',
          },
        },
        before: {
          inputPath: beforePath,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('requested billing window requires both start and end');
  });

  it('rejects malformed or unbounded billing input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-invalid-'));
    roots.push(root);
    const invalidPath = join(root, 'invalid.jsonl');
    await writeFile(invalidPath, '{"EffectiveCost":"not-a-number"}\n');
    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: invalidPath,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('billing row has an invalid ChargePeriodStart');

    const oversizedPath = join(root, 'oversized.jsonl');
    const validRow = JSON.stringify({
      BillingCurrency: 'USD',
      ChargePeriodStart: '2026-08-01T00:00:00.000Z',
      ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
      ConsumedQuantity: 1,
      ConsumedUnit: 'Count',
      EffectiveCost: 1,
      ServiceName: 'Function Invocations',
      Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
    });
    await writeFile(
      oversizedPath,
      `${`${validRow}\n`.repeat(MAX_INPUT_ROWS + 1)}`
    );
    await expect(
      measureVercelStorefrontCost({
        before: {
          inputPath: oversizedPath,
          window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
        },
        projectId: MEASUREMENT_PROJECT_ID,
      })
    ).rejects.toThrow('exceeds the 100000-row bound');
  });

  it('bugfix: nets negative FOCUS EffectiveCost credits into the window total', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-credit-'));
    roots.push(root);
    const creditPath = join(root, 'credit.jsonl');
    await writeFile(
      creditPath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 10,
        ConsumedUnit: 'Count',
        EffectiveCost: 5,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: 0,
        ConsumedUnit: 'Count',
        EffectiveCost: -1.5,
        ServiceName: 'Function Invocations',
        Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
      })}\n`
    );

    const result = await measureVercelStorefrontCost({
      before: {
        inputPath: creditPath,
        window: { deploymentSha: MEASUREMENT_BEFORE_SHA, label: 'before' },
      },
      projectId: MEASUREMENT_PROJECT_ID,
    });

    expect(result.before.metrics.projectEffectiveCostUsd).toBe(3.5);
    expect(result.before.metrics.services.functionInvocations).toBe(10);
  });

  it('still rejects negative ConsumedQuantity values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-qty-'));
    roots.push(root);
    const invalidPath = join(root, 'negative-qty.jsonl');
    await writeFile(
      invalidPath,
      `${JSON.stringify({
        BillingCurrency: 'USD',
        ChargePeriodStart: '2026-08-01T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
        ConsumedQuantity: -1,
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
    ).rejects.toThrow('billing row has an invalid ConsumedQuantity');
  });
});
