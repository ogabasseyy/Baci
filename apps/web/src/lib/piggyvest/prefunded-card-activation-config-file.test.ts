import { spawnSync } from 'node:child_process';
import { chmod, link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPrefundedCardActivationConfig } from './prefunded-card-activation-config';
import { createActivationConfigFixture } from './prefunded-card-activation-config.test-support';
import { readPrefundedCardActivationConfig } from './prefunded-card-activation-config-file';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function privateDirectory() {
  const directory = await mkdtemp(
    join(tmpdir(), 'prefunded-card-config-test-')
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe('prefunded card activation config file reader', () => {
  it('retains validated source for readiness without reparsing injected profile fields', async () => {
    const path = join(await privateDirectory(), 'config.json');
    const source = createActivationConfigFixture();
    const now = new Date('2026-09-27T12:00:00Z');
    await writeFile(path, JSON.stringify(source), { mode: 0o600 });
    const result = await readPrefundedCardActivationConfig(path, now);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Fixture config refused');
    expect(result.configuration.background.database.treasury.profile).toBe(
      'worker'
    );
    expect(result).toHaveProperty('source', source);
    if (!('source' in result))
      throw new Error('Original configuration missing');
    expect(buildPrefundedCardActivationConfig(result.source, now).ok).toBe(
      true
    );
    expect(
      buildPrefundedCardActivationConfig(result.configuration, now).ok
    ).toBe(false);
  });

  it('refuses group-readable files without echoing contents', async () => {
    const path = join(await privateDirectory(), 'config.json');
    await writeFile(
      path,
      JSON.stringify({ marker: 'synthetic-private-marker' }),
      { mode: 0o600 }
    );
    await chmod(path, 0o644);
    const result = await readPrefundedCardActivationConfig(
      path,
      new Date('2026-09-27T12:00:00Z')
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ status: 'missing_or_invalid' }],
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
  });

  it('refuses hard-linked config files', async () => {
    const directory = await privateDirectory();
    const path = join(directory, 'config.json');
    await writeFile(path, '{}', { mode: 0o600 });
    await link(path, join(directory, 'config-hardlink.json'));
    const result = await readPrefundedCardActivationConfig(
      path,
      new Date('2026-09-27T12:00:00Z')
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ prerequisite: 'owner-only regular UTF-8 JSON config file' }],
    });
  });

  it('bounds file reads to the configured maximum plus one byte', async () => {
    const path = join(await privateDirectory(), 'config.json');
    await writeFile(path, Buffer.alloc(131_073, 32), { mode: 0o600 });
    const result = await readPrefundedCardActivationConfig(
      path,
      new Date('2026-09-27T12:00:00Z')
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ prerequisite: 'owner-only regular UTF-8 JSON config file' }],
    });
  });

  it('runs the documented CLI with server conditions and redacts invalid private input', async () => {
    const path = join(await privateDirectory(), 'config.json');
    const marker = 'synthetic-private-marker';
    await writeFile(path, JSON.stringify({ marker }), { mode: 0o600 });
    const nodeOptions = [process.env.NODE_OPTIONS, '--conditions=react-server']
      .filter(Boolean)
      .join(' ');
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'tsx',
        '../../tools/staging/prefunded-card/activation-config-preflight.ts',
        path,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: nodeOptions },
      }
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(output).toContain(
      'missing_or_invalid: strict activation configuration shape'
    );
    expect(output).not.toContain(marker);
    expect(output).not.toContain(path);
  });
});
