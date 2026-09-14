import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dockerArgs,
  runKey,
  runMatrix,
  SITESPEED_IMAGE,
  selectRuns,
  validateArtifacts,
} from './run-storefront-sitespeed.mjs';
import { parseArgs } from './sitespeed-cli-options.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('storefront sitespeed matrix runner', () => {
  it('expands the checked-in matrix into ordered cold samples and supports selection', () => {
    const matrix = {
      profiles: ['mobile', 'desktop'],
      coldRuns: 3,
      routes: [
        { family: 'home', path: '/' },
        { family: 'blog', path: '/blog' },
      ],
    };
    expect(
      selectRuns(matrix, { profiles: ['mobile'], families: ['blog'] })
    ).toEqual([
      { profile: 'mobile', family: 'blog', path: '/blog', sample: 1 },
      { profile: 'mobile', family: 'blog', path: '/blog', sample: 2 },
      { profile: 'mobile', family: 'blog', path: '/blog', sample: 3 },
    ]);
    expect(runKey({ profile: 'desktop', family: 'home', sample: 2 })).toBe(
      'desktop/home/2'
    );
  });

  it('pins the image, uses outputFolder and records native browser profiles', () => {
    const args = dockerArgs(
      { profile: 'mobile', family: 'home', path: '/', sample: 1 },
      '/tmp/out',
      'http://host.docker.internal:3105'
    );
    expect(args).toContain(SITESPEED_IMAGE);
    expect(args).toContain('--outputFolder');
    expect(args).toContain('/sitespeed.io/mobile/home/sample-1');
    expect(args).toContain('--video');
    expect(args).toContain('--visualMetrics');
    expect(args).toContain('--browsertime.chrome.collectConsoleLog');
    expect(args).toContain('--mobile');
  });

  it('dry-run plans selected routes without Docker, disk writes, or claiming a measurement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sitespeed-runner-'));
    directories.push(directory);
    const result = await runMatrix({
      outputFolder: join(directory, 'out'),
      profiles: ['desktop'],
      families: ['home'],
      dryRun: true,
      spawn: () => {
        throw new Error('Docker must not run');
      },
    });
    expect(result.dryRun).toBe(true);
    expect(result.runs).toHaveLength(3);
    expect(result.manifest.profileMode).toContain('native');
    expect(result.manifest.runs).toEqual({});
  });

  it('rejects an incomplete artifact directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sitespeed-artifacts-'));
    directories.push(directory);
    await writeFile(join(directory, 'visualMetrics.json'), '{}');
    await expect(() => validateArtifacts(directory)).toThrow(
      /missing sitespeed artifacts/
    );
    await mkdir(join(directory, 'video'));
    await writeFile(join(directory, 'video', 'run.mp4'), 'video');
    await writeFile(join(directory, 'run.har'), '{}');
    expect(() => validateArtifacts(directory)).toThrow(/visualMetrics/);
  });

  it('accepts HAR visual metrics and records the actual browser, not an emulated user agent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sitespeed-valid-'));
    directories.push(directory);
    const browser = {
      name: 'Chrome Emulated Moto G4',
      version: '151.0.7922.169',
    };
    await writeFile(join(directory, 'run.mp4'), 'video');
    await writeFile(
      join(directory, 'run.har'),
      JSON.stringify({
        log: {
          browser,
          pages: [
            {
              _visualMetrics: { FirstVisualChange: 100, LastVisualChange: 200 },
            },
          ],
        },
      })
    );
    expect(validateArtifacts(directory)).toMatchObject({
      video: true,
      har: true,
      visualMetrics: true,
      browser,
    });
  });

  it('rejects missing CLI values and parses bounded selections', () => {
    expect(() => parseArgs(['--profile'])).toThrow(/missing value/);
    expect(parseArgs(['--profile', 'mobile', '--max-runs', '2'])).toMatchObject(
      { profiles: ['mobile'], maxRuns: 2 }
    );
  });

  it('rejects invalid bounds before spawning a browser', async () => {
    for (const options of [
      { minFreeGiB: Number.NaN },
      { minFreeGiB: 4 },
      { samples: 0 },
      { maxRuns: -1 },
    ]) {
      await expect(runMatrix({ ...options, dryRun: true })).rejects.toThrow();
    }
  });

  it('rejects mixed valid and invalid selections instead of silently dropping coverage', () => {
    const matrix = {
      profiles: ['mobile'],
      coldRuns: 1,
      routes: [{ family: 'home', path: '/' }],
    };
    expect(() => selectRuns(matrix, { families: ['home', 'typo'] })).toThrow(
      /unknown selection/
    );
    expect(() => selectRuns(matrix, { profiles: ['mobile', 'typo'] })).toThrow(
      /unknown selection/
    );
  });

  it('rejects failed images despite valid visual metrics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sitespeed-failed-image-'));
    directories.push(directory);
    await writeFile(join(directory, 'run.mp4'), 'video');
    await writeFile(
      join(directory, 'run.har'),
      JSON.stringify({
        log: {
          pages: [
            {
              _visualMetrics: { FirstVisualChange: 100, LastVisualChange: 200 },
            },
          ],
          entries: [
            {
              _resourceType: 'image',
              response: { status: 403, content: { mimeType: 'text/html' } },
            },
          ],
        },
      })
    );
    expect(() => validateArtifacts(directory)).toThrow(
      /failed critical resource/
    );
  });

  it('rejects a HAR that has no visual metric page metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sitespeed-no-metrics-'));
    directories.push(directory);
    await writeFile(
      join(directory, 'run.har'),
      JSON.stringify({ log: { pages: [{ pageTimings: {} }] } })
    );
    await writeFile(join(directory, 'run.mp4'), 'video');
    expect(() => validateArtifacts(directory)).toThrow(/visualMetrics/);
  });
});
