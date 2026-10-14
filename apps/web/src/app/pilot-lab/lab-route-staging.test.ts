import { readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadLabConfigAtStartup as getLabConfig,
  getLabConfig as getRequestLabConfig,
  initializeLabRuntime,
} from './lab-route';
import { setupRouteFiles, stageRouteFiles } from './lab-route-staging-fixtures';

describe('getLabConfig', () => {
  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for('baci.merchant-image-pilot.runtime')
    );
    vi.unstubAllEnvs();
  });

  it('serves frozen inputs but fails closed when staged bytes vanish', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await expect(getRequestLabConfig()).rejects.toThrow(/startup validation/);
    await stageRouteFiles(lab);
    await initializeLabRuntime();
    const first = await getRequestLabConfig();
    // Operator roots are frozen into the snapshot: their post-start
    // disappearance changes nothing about what the lab serves.
    await rm(lab.inputRoot, { recursive: true });
    await rm(lab.outputRoot, { recursive: true });
    await expect(getRequestLabConfig()).resolves.toBe(first);
    // Staged bytes are served live from disk by Next: a post-start
    // deletion must fail closed (re-stage + restart) instead of
    // rendering URLs for 404s until the next restart.
    await rm(lab.publicDir, { recursive: true });
    await expect(getRequestLabConfig()).rejects.toThrow(
      /pilot:stage and restart/
    );
  });

  it('reuses the frozen runtime when initialized twice in one process', async () => {
    // Dev-server reloads re-run register(): the second init must reuse
    // the frozen config instead of throwing 'restart to replace' —
    // which the boot gate would misread as a failed init and refuse
    // on the normal staged tree. The publish guard itself still
    // refuses replacement (see lab-runtime.test.ts).
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await stageRouteFiles(lab);
    const first = await initializeLabRuntime();
    await expect(initializeLabRuntime()).resolves.toBe(first);
  });

  it('fails closed when a file is planted after boot', async () => {
    // Next serves public/__pilot statically without invoking lab
    // handlers, so a file planted after boot is servable until the
    // next lab page render — at which point the per-request binding
    // check must refuse instead of serving it alongside bound bytes.
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await stageRouteFiles(lab);
    await initializeLabRuntime();
    const first = await getRequestLabConfig();
    expect(first.stagedPaths.length).toBeGreaterThan(0);
    const generationDir = dirname(first.stagedPaths[0]?.path as string);
    await writeFile(join(generationDir, 'planted.png'), 'planted bytes');
    await expect(getRequestLabConfig()).rejects.toThrow(
      /has no inventory binding/
    );
  });

  it('names planted content after a degraded runtime-less boot', async () => {
    // Degraded boot publishes no runtime, so no lab page can render to
    // re-check — but the request path must still fail LOUD on staged
    // content (empty binding set) instead of serving it statically in
    // silence behind a bare runtime error.
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await stageRouteFiles(lab);
    await expect(getRequestLabConfig()).rejects.toThrow(/empty binding set/);
  });

  it('fails closed on unstaged bytes, then serves once staged', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    // Fresh load with nothing staged: the read-only loader refuses to
    // write and fails with the operator fix (stage + restart).
    await expect(getLabConfig()).rejects.toThrow(/pilot:stage and restart/);
    // The pre-start step stages (default load stages); routes then serve.
    await stageRouteFiles(lab);
    const first = await getLabConfig();
    expect(first.stagedPaths.length).toBeGreaterThan(0);
    // Same frozen inputs: the second load takes the cached path.
    const second = await getLabConfig();
    expect(second).toBe(first);
    // Delete one staged tier: the cache must fail closed instead of
    // serving URLs for 404 bytes.
    const [deleted] = first.stagedPaths;
    await rm(deleted?.path as string);
    await expect(getLabConfig()).rejects.toThrow(/pilot:stage and restart/);
  });

  it('reloads on frozen-input edits, even same-size same-mtime rewrites', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await stageRouteFiles(lab);
    const first = await getLabConfig();
    const inventoryPath = join(lab.inputRoot, 'inventory.json');
    // Size-changing edit invalidates the fingerprint key: full reload.
    const text = await readFile(inventoryPath, 'utf8');
    await writeFile(inventoryPath, `${text} `);
    // Synthetic ms-quantized mtime: raw stat mtimes carry sub-ms
    // fractions that utimes cannot round-trip exactly.
    const afterEdit = await stat(inventoryPath);
    const pinned = new Date(afterEdit.mtimeMs + 2000);
    await utimes(inventoryPath, pinned, pinned);
    const second = await getLabConfig();
    expect(second).not.toBe(first);
    // Same-size rewrite with a pinned mtime still reloads: the write
    // itself bumps ctime, which the fingerprint binds, so utimens
    // cannot hide an operator edit behind a frozen mtime.
    await writeFile(inventoryPath, ` ${text}`);
    await utimes(inventoryPath, pinned, pinned);
    const third = await getLabConfig();
    expect(third).not.toBe(second);
  });
});
