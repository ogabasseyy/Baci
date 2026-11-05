import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('runs from a path with spaces and # and reports missing config without networking', async () => {
  const sourcePath = join(
    dirname(fileURLToPath(import.meta.url)),
    'chatwoot-compatibility-probe.ts'
  );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'chatwoot probe #'));
  const copiedScript = join(temporaryDirectory, 'probe # copy.ts');
  const importWrapper = join(temporaryDirectory, 'import wrapper.ts');
  const tsxPackage = createRequire(import.meta.url).resolve('tsx/package.json');
  const tsxCli = join(dirname(tsxPackage), 'dist', 'cli.mjs');
  try {
    await symlink(
      join(process.cwd(), '../../node_modules'),
      join(temporaryDirectory, 'node_modules')
    );
    await writeFile(
      join(temporaryDirectory, 'package.json'),
      JSON.stringify({ type: 'module' })
    );
    await copyFile(sourcePath, copiedScript);
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key.startsWith('CHATWOOT_PROBE_')) delete environment[key];
    }
    const result = spawnSync(process.execPath, [tsxCli, copiedScript], {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'invalid-configuration',
    });

    await writeFile(
      importWrapper,
      "import { pathToFileURL } from 'node:url';\nvoid import(pathToFileURL(process.argv[2]!).href);\n"
    );
    const imported = spawnSync(
      process.execPath,
      [tsxCli, importWrapper, copiedScript],
      {
        cwd: process.cwd(),
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
    expect(imported.error).toBeUndefined();
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toBe('');
    expect(imported.stderr).toBe('');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}, 30_000);
