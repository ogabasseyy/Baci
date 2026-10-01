import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMeasurementFixtureFiles,
  MEASUREMENT_AFTER_SHA,
  MEASUREMENT_BEFORE_SHA,
  MEASUREMENT_PROJECT_ID,
} from './measure-vercel-storefront-cost.test-support';
import { runMeasurementCli } from './measure-vercel-storefront-cost-cli';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe('runMeasurementCli', () => {
  it('writes a measurement report when --out is supplied', async () => {
    const { afterPath, beforePath, root } =
      await createMeasurementFixtureFiles(roots);
    const outputPath = join(root, 'measurement.json');

    await runMeasurementCli([
      '--project-id',
      MEASUREMENT_PROJECT_ID,
      '--before',
      beforePath,
      '--before-sha',
      MEASUREMENT_BEFORE_SHA,
      '--after',
      afterPath,
      '--after-sha',
      MEASUREMENT_AFTER_SHA,
      '--out',
      outputPath,
    ]);

    const report = JSON.parse(await readFile(outputPath, 'utf8')) as {
      projectId: string;
      schemaVersion: number;
    };
    expect(report.projectId).toBe(MEASUREMENT_PROJECT_ID);
    expect(report.schemaVersion).toBe(1);
  });

  it('rejects --out paths that alias an evidence input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-cli-alias-'));
    roots.push(root);
    const { beforePath } = await createMeasurementFixtureFiles(roots);

    await expect(
      runMeasurementCli([
        '--project-id',
        MEASUREMENT_PROJECT_ID,
        '--before',
        beforePath,
        '--before-sha',
        MEASUREMENT_BEFORE_SHA,
        '--out',
        beforePath,
      ])
    ).rejects.toThrow('measurement --out must not overwrite an input path');
  });
});
