// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserProvenanceArg,
  DATED_PAGE,
  pngBuffer,
  provenanceArg,
  ROUTE,
  runWithEntries,
  screenshotProvenanceArg,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';

describe('merchant-image-pilot-settings-cli-fixtures', () => {
  it('writes provenance CLI arguments and executes settings CLI via runWithEntries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-cli-fix-'));
    try {
      const bytes = await pngBuffer(48, 48);
      expect(ROUTE).toContain('/pilot-lab/store/ogabassey');
      expect(DATED_PAGE._url).toBe(ROUTE);

      const cacheArg = await provenanceArg(dir);
      expect(cacheArg).toMatch(/^--cache-provenance=/);

      const shotArg = await screenshotProvenanceArg(dir, bytes);
      expect(shotArg).toMatch(/^--screenshot-provenance=/);

      const browserArg = await browserProvenanceArg(dir);
      expect(browserArg).toMatch(/^--browser-provenance=/);

      const { error, report } = await runWithEntries([{ status: 200 }], {
        provenance: {},
      });
      expect(error).toBeNull();
      expect(report.ok).toBe(true);
      expect(report.failures).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('removes its temporary evidence after the CLI completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pilot-fixture-cleanup-test-'));
    try {
      const result = await runWithEntries([{ status: 200 }], {
        provenance: {},
        temporaryRoot: root,
      });
      expect(result.error).toBeNull();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('cleans up and reports a child launch failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pilot-fixture-failure-test-'));
    try {
      await expect(
        runWithEntries([{ status: 200 }], {
          provenance: {},
          nodeExecutable: join(root, 'missing-node'),
          temporaryRoot: root,
        })
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('cleans up after a normal CLI rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pilot-fixture-rejection-test-'));
    try {
      const result = await runWithEntries([{ status: 200 }], {
        provenance: {},
        browser: false,
        temporaryRoot: root,
      });
      expect(result.error?.code).toBe(1);
      expect(result.report.ok).toBe(false);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
