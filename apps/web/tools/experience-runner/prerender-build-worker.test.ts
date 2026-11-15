import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureManifest } from '../../tests/experience-browser/fixtures/qualification-fixtures';
import { packPrivateBuild } from './private-build-payload';

const appRoot = process.cwd();
const generatedBundle = path.join(
  appRoot,
  'tools/experience-runner/bundle-source-prerender.mjs'
);
const fixtureDirs: string[] = [];
let generatedBundleOwned = false;

afterEach(() => {
  for (const dir of fixtureDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  if (generatedBundleOwned) {
    rmSync(generatedBundle, { force: true });
    generatedBundleOwned = false;
  }
});

describe('prerender build worker subprocess', () => {
  it('reads a bounded private build from stdin and returns separately compiled client and renderer bundles', async () => {
    expect(existsSync(generatedBundle)).toBe(false);
    const fixtureRoot = mkdtempSync(
      path.join(tmpdir(), 'baci-prerender-worker-')
    );
    fixtureDirs.push(fixtureRoot);
    generatedBundleOwned = true;

    await build({
      entryPoints: ['tools/experience-runner/bundle-source.ts'],
      outfile: generatedBundle,
      absWorkingDir: appRoot,
      bundle: true,
      platform: 'node',
      format: 'esm',
      external: ['esbuild'],
      logLevel: 'silent',
    });
    const workerPath = path.join(fixtureRoot, 'prerender-build-worker.mjs');
    const boundedPath = path.join(fixtureRoot, 'bounded-input.mjs');
    const linkedBundle = path.join(
      fixtureRoot,
      'tools/experience-runner/bundle-source-prerender.mjs'
    );
    mkdirSync(path.dirname(linkedBundle), { recursive: true });
    copyFileSync(
      path.join(appRoot, 'tools/experience-runner/prerender-build-worker.mjs'),
      workerPath
    );
    copyFileSync(
      path.join(appRoot, 'tests/experience-performance/bounded-input.mjs'),
      boundedPath
    );
    symlinkSync(generatedBundle, linkedBundle);

    const hostOrigin = 'http://127.0.0.1:43174';
    const wire = packPrivateBuild(
      fixtureManifest('device-configurator'),
      hostOrigin
    );
    const stdout = execFileSync(process.execPath, [workerPath], {
      cwd: fixtureRoot,
      input: JSON.stringify(wire),
      encoding: 'utf8',
    });
    const result: unknown = JSON.parse(stdout);
    expect(result).toEqual({
      client: expect.objectContaining({
        hostOrigin,
        javascript: expect.any(String),
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        imports: expect.any(Array),
      }),
      renderer: expect.objectContaining({
        javascript: expect.any(String),
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        imports: expect.any(Array),
      }),
    });
    expect(
      (result as { client: { digest: string }; renderer: { digest: string } })
        .client.digest
    ).not.toBe(
      (result as { client: { digest: string }; renderer: { digest: string } })
        .renderer.digest
    );
  });
});
