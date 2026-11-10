// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { simulateStagingCallbacks } from './simulate';

it('refuses an existing evidence directory without overwriting its contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxygen-preserve-'));
  try {
    await writeFile(join(directory, 'existing-inbox'), 'preserve');
    await expect(simulateStagingCallbacks(directory)).rejects.toThrow(
      'empty directory'
    );
    expect(await readdir(directory)).toEqual(['existing-inbox']);
    expect(await readFile(join(directory, 'existing-inbox'), 'utf8')).toBe(
      'preserve'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('exercises documented callbacks over HTTP and preserves separate durable simulation evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxygen-simulation-'));
  try {
    const result = await simulateStagingCallbacks(directory);
    expect(result).toMatchObject({
      simulationOnly: true,
      providerCalls: 0,
      realOrderChanges: 0,
      authenticatedSamples: 4,
      duplicateAcknowledgements: 3,
      unauthenticatedStatus: 401,
      invalidPayloadStatus: 400,
      conflictingReplayStatus: 503,
      afterRestart: [
        { kind: 'address', count: 1 },
        { kind: 'settlement', count: 2 },
        { kind: 'transaction', count: 1 },
      ],
      bankReceiptConfirmed: false,
      activationAuthorized: false,
    });
    const report = JSON.parse(
      await readFile(join(directory, 'simulation-report.json'), 'utf8')
    );
    expect(report).toEqual(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
