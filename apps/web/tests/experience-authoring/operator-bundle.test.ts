import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { bundleBuilderOperator } from '../../tools/builder-production/operator-bundle';

const require = createRequire(import.meta.url);
it('builds the builder operator without frontend condition or native dependency failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-builder-operator-'));
  try {
    const modules = join(root, 'node_modules');
    mkdirSync(modules);
    for (const [name, path] of [
      ['next', dirname(require.resolve('next/package.json'))],
      ['jsdom', dirname(require.resolve('jsdom/package.json'))],
      ['sharp', dirname(dirname(require.resolve('sharp')))],
    ])
      symlinkSync(path, join(modules, name), 'dir');
    const bundle = join(root, 'builder.mjs');
    const result = await bundleBuilderOperator(bundle);
    expect(result.warnings).toEqual([]);
    const widget = readFileSync(join(root, 'preview.html'), 'utf8');
    expect(widget).toContain('id="root"');
    expect(widget).not.toMatch(/fixture-camera|actorUserId|connectionId/);
    const resourceBundle = join(root, 'resource.mjs');
    await build({
      entryPoints: ['builder-mcp-server/preview-resource.ts'],
      outfile: resourceBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
    });
    const resourceModule = await import(pathToFileURL(resourceBundle).href);
    let readResource:
      | (() => Promise<{ contents: Array<{ text: string }> }>)
      | undefined;
    resourceModule.registerBuilderPreviewResource({
      registerResource(
        _name: string,
        _uri: string,
        _options: unknown,
        read: typeof readResource
      ) {
        readResource = read;
      },
    });
    if (!readResource) throw Error('Missing preview resource');
    expect((await readResource()).contents[0].text).toBe(widget);
    const check = spawnSync(process.execPath, ['--check', bundle], {
      encoding: 'utf8',
    });
    expect(check.status).toBe(0);
    const run = spawnSync(process.execPath, [bundle], {
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe('Baci builder could not start.');
    expect(
      execFileSync(
        process.execPath,
        ['-e', 'console.log(require("sharp").versions.sharp)'],
        { cwd: root, encoding: 'utf8' }
      ).trim()
    ).toMatch(/^\d/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
