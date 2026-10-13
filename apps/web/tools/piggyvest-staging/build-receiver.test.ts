import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReceiver } from './build-receiver';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'piggyvest-receiver-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('buildReceiver', () => {
  it('builds a standalone Node 24 receiver with staging binding', async () => {
    const output = await buildReceiver(directory, 'prj_synthetic');
    const functionDirectory = join(
      output,
      'functions/api/webhooks/piggyvest.func'
    );
    expect(
      JSON.parse(
        await readFile(join(functionDirectory, '.vc-config.json'), 'utf8')
      )
    ).toEqual({
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      maxDuration: 30,
      environment: {
        PVB_INTEGRATION_ENV: 'staging',
        PVB_STAGING_REGISTRATION_PROJECT_ID: 'prj_synthetic',
      },
    });
    expect(
      JSON.parse(await readFile(join(output, 'config.json'), 'utf8'))
    ).toEqual({ version: 3 });
    expect((await readdir(output)).sort()).toEqual([
      'config.json',
      'functions',
    ]);
    expect((await readdir(functionDirectory)).sort()).toEqual([
      '.vc-config.json',
      'index.mjs',
    ]);
    const compiled = await readFile(
      join(functionDirectory, 'index.mjs'),
      'utf8'
    );
    expect(compiled).not.toContain('import type');
    expect(compiled).toContain('node:crypto');
    expect(compiled).toContain(
      'https://staging-auth.ogabassey.com/piggyvest/intake'
    );
    expect(compiled).not.toContain('registration_ready');
    expect(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'const handler = (await import(process.argv[1])).default; if (typeof handler !== "function") process.exit(1);',
          join(functionDirectory, 'index.mjs'),
        ],
        { encoding: 'utf8' }
      )
    ).toBe('');
  });

  it.each([
    '',
    'other',
    'prj_../escape',
  ])('rejects invalid project binding %s', async (projectId) => {
    await expect(buildReceiver(directory, projectId)).rejects.toThrow(
      'A staging Vercel project ID is required'
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses to overwrite existing output', async () => {
    await buildReceiver(directory, 'prj_synthetic');
    await expect(buildReceiver(directory, 'prj_other')).rejects.toThrow();
  });
});
