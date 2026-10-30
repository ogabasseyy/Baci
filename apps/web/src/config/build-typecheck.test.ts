// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILD_TYPESCRIPT_CONFIG,
  BUILD_TYPESCRIPT_EXPERIMENTS,
} from './build-typecheck';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const compiler = join(
  dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'lib/tsc.js'
);
const buildConfigPath = resolve(webRoot, BUILD_TYPESCRIPT_CONFIG.tsconfigPath);

function compile(project: string, args: string[] = []) {
  const result = spawnSync(
    process.execPath,
    [compiler, '--project', project, ...args],
    {
      cwd: webRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
    }
  );
  expect(result.error).toBeUndefined();
  return result;
}

function resolvedConfig(project: string): unknown {
  const result = compile(project, ['--showConfig']);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('production build type checking', () => {
  it('keeps the CLI and rejects type errors', () => {
    expect(BUILD_TYPESCRIPT_EXPERIMENTS.useTypeScriptCli).toBe(true);
    expect(BUILD_TYPESCRIPT_CONFIG.ignoreBuildErrors).toBe(false);
  });

  it('inherits the exact application file set and compiler settings', () => {
    const buildConfig: unknown = JSON.parse(
      readFileSync(buildConfigPath, 'utf8')
    );
    expect(buildConfig).toEqual({
      extends: './tsconfig.json',
      compilerOptions: { checkers: 1 },
    });
    // Native --showConfig omits the performance-only checker count. Comparing
    // its resolved outputs catches changes to files, strictness and aliases.
    expect(resolvedConfig(buildConfigPath)).toEqual(
      resolvedConfig(resolve(webRoot, 'tsconfig.json'))
    );
  });

  it('actually uses one checker and still rejects errors in inherited files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baci-native-build-check-'));
    try {
      mkdirSync(join(dir, 'src'));
      const files = Array.from({ length: 8 }, (_, index) =>
        join(dir, 'src', `fixture-${index}.ts`)
      );
      for (const [index, file] of files.entries()) {
        writeFileSync(file, `export const value${index}: string = 'valid';\n`);
      }
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            types: [],
            target: 'ES2022',
          },
          include: ['src/**/*.ts'],
        })
      );
      const project = join(dir, 'tsconfig.build.json');
      writeFileSync(project, readFileSync(buildConfigPath));
      const trace = join(dir, 'trace');
      const valid = compile(project, ['--generateTrace', trace, '--listFiles']);
      expect(valid.status, valid.stdout + valid.stderr).toBe(0);
      for (const file of files) expect(valid.stdout).toContain(file);
      expect(
        readdirSync(trace).filter((name) => /^types_\d+\.json$/.test(name))
      ).toEqual(['types_0.json']);

      writeFileSync(files[7], 'export const invalid: string = 42;\n');
      const invalid = compile(project);
      expect(invalid.status).toBe(1);
      expect(invalid.stdout + invalid.stderr).toContain('TS2322');
      expect(invalid.stdout + invalid.stderr).toContain('fixture-7.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
