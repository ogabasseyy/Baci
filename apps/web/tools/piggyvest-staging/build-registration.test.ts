import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRegistration } from './build-registration';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'piggyvest-registration-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('buildRegistration', () => {
  it('builds only the standalone registration function with staging project binding', async () => {
    const output = await buildRegistration(directory, 'prj_synthetic');
    const functionDirectory = join(
      output,
      'functions/api/webhooks/piggyvest.func'
    );
    const config = JSON.parse(
      await readFile(join(functionDirectory, '.vc-config.json'), 'utf8')
    );
    expect(config.environment).toEqual({
      PVB_INTEGRATION_ENV: 'staging',
      PVB_STAGING_REGISTRATION_PROJECT_ID: 'prj_synthetic',
    });
    expect(config.runtime).toBe('nodejs24.x');
    expect(await readdir(output)).toEqual(['config.json', 'functions']);
    const compiled = await readFile(
      join(functionDirectory, 'index.mjs'),
      'utf8'
    );
    expect(compiled).not.toContain('import type');
    expect(compiled).not.toContain('supabase');
    expect(compiled).toContain('registration_ready');
  });

  it('rejects a missing project binding before creating build output', async () => {
    await expect(buildRegistration(directory, '')).rejects.toThrow(
      'A staging Vercel project ID is required'
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses to overwrite existing build output', async () => {
    await buildRegistration(directory, 'prj_synthetic');
    await expect(buildRegistration(directory, 'prj_other')).rejects.toThrow();
  });
});
