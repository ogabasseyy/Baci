import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MEASUREMENT_PROJECT_ID = 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx';
export const MEASUREMENT_BEFORE_SHA = 'a'.repeat(40);
export const MEASUREMENT_AFTER_SHA = 'b'.repeat(40);

export async function createMeasurementFixtureFiles(roots: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'vercel-cost-measurement-'));
  roots.push(root);
  const beforePath = join(root, 'before.jsonl');
  const afterPath = join(root, 'after.jsonl');
  const cachePath = join(root, 'cache.jsonl');
  const afterCachePath = join(root, 'after-cache.jsonl');
  const beforeDbTracePath = join(root, 'before-db.jsonl');
  const afterDbTracePath = join(root, 'after-db.jsonl');
  const beforeRows = [
    {
      BillingCurrency: 'USD',
      ChargePeriodStart: '2026-08-01T00:00:00.000Z',
      ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
      ConsumedQuantity: 10,
      ConsumedUnit: 'Hours',
      EffectiveCost: 2.5,
      ServiceName: 'Fluid Active CPU',
      Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
    },
    {
      BillingCurrency: 'USD',
      ChargePeriodStart: '2026-08-01T00:00:00.000Z',
      ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
      ConsumedQuantity: 100,
      ConsumedUnit: 'Count',
      EffectiveCost: 1,
      ServiceName: 'Function Invocations',
      Tags: { ProjectId: MEASUREMENT_PROJECT_ID },
    },
    {
      BillingCurrency: 'USD',
      ChargePeriodStart: '2026-08-01T00:00:00.000Z',
      ChargePeriodEnd: '2026-08-02T00:00:00.000Z',
      ConsumedQuantity: 900,
      ConsumedUnit: 'Hours',
      EffectiveCost: 9,
      ServiceName: 'Fluid Active CPU',
      Tags: { ProjectId: 'prj_other' },
    },
  ];
  const afterRows = [
    {
      ...beforeRows[0],
      ChargePeriodStart: '2026-08-02T00:00:00.000Z',
      ChargePeriodEnd: '2026-08-03T00:00:00.000Z',
      ConsumedQuantity: 4,
      EffectiveCost: 1,
    },
    {
      ...beforeRows[1],
      ChargePeriodStart: '2026-08-02T00:00:00.000Z',
      ChargePeriodEnd: '2026-08-03T00:00:00.000Z',
      ConsumedQuantity: 40,
      EffectiveCost: 0.4,
    },
  ];
  await writeFile(
    beforePath,
    `${beforeRows.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
  await writeFile(
    afterPath,
    `${afterRows.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
  await writeFile(
    cachePath,
    `${JSON.stringify({ cacheStatus: 'HIT', ttfbMs: 12 })}\n${JSON.stringify({ cacheStatus: 'MISS', ttfbMs: 40 })}\n${JSON.stringify({ cacheStatus: 'STALE', ttfbMs: 20 })}\n${JSON.stringify({ cacheStatus: 'PRERENDER', ttfbMs: 18 })}\n`
  );
  await writeFile(
    afterCachePath,
    `${JSON.stringify({ cacheStatus: 'HIT', ttfbMs: 10 })}\n${JSON.stringify({ cacheStatus: 'MISS', ttfbMs: 30 })}\n`
  );
  await writeFile(
    beforeDbTracePath,
    `${JSON.stringify({ cohort: 'pdp', dbCalls: 4, dbTimeouts: 1 })}\n${JSON.stringify({ cohort: 'compare', dbCalls: 2, dbTimeouts: 0 })}\n`
  );
  await writeFile(
    afterDbTracePath,
    `${JSON.stringify({ cohort: 'pdp', dbCalls: 1, dbTimeouts: 0 })}\n${JSON.stringify({ cohort: 'compare', dbCalls: 1, dbTimeouts: 0 })}\n`
  );
  return {
    afterCachePath,
    afterDbTracePath,
    afterPath,
    beforeDbTracePath,
    beforePath,
    cachePath,
    root,
  };
}
