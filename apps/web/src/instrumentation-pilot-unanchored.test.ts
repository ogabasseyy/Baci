import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

// Unanchored-boot tests against the REAL public-assets resolver (the
// mocked suite cannot exercise the anchor throw path): with the lab
// off, a boot whose public tree cannot be anchored must check every
// candidate tree it can find and refuse on DETECTED staged content —
// only a found-nothing boot degrades to a loud warning, never a brick.
const registerOTelMock = vi.hoisted(() => vi.fn());
const captureServerEventMock = vi.hoisted(() => vi.fn());
const setRateLimitDiagnosticHookMock = vi.hoisted(() => vi.fn());

vi.mock('@vercel/otel', () => ({
  registerOTel: registerOTelMock,
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  setRateLimitDiagnosticHook: setRateLimitDiagnosticHookMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function stubUnanchoredBoot() {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
  vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
  vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
}

function withStagedTree(publicDir: string) {
  const originals = join(publicDir, '__pilot', 'originals');
  mkdirSync(originals, { recursive: true });
  writeFileSync(join(originals, 'm1-a1.png'), 'merchant bytes');
}

describe('instrumentation unanchored boot', () => {
  it('warns and completes with lab off and no checkable tree', async () => {
    // Bare sandbox cwd (no public/, no next.config) and a vitest
    // worker argv with no adjacent public/: nothing checkable, so boot
    // warns loudly and completes instead of bricking on the anchor
    // failure itself.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/found no checkable app tree/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('warns and completes with lab off and a clean app-root cwd', async () => {
    // Sandbox cwd WITH a public/ dir: plausibly the served app root,
    // so the candidate check runs (finding nothing to refuse) and boot
    // completes with the loud anchor warning.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-'));
    mkdirSync(join(sandbox, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/checked 1 candidate tree/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('refuses staged content in the cwd candidate with lab off', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-staged-'));
    withStagedTree(join(sandbox, 'public'));
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      await expect(register()).rejects.toThrow(/staged merchant pilot assets/);
      expect(registerOTelMock).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('refuses staged content beside the server entry script', async () => {
    // Bare cwd, but argv[1] sits next to a staged app tree (the custom
    // `node /app/server.js` shape): the server-adjacent candidate is
    // checked and refuses.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    const appRoot = mkdtempSync(join(tmpdir(), 'pilot-unanchored-app-'));
    withStagedTree(join(appRoot, 'public'));
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(sandbox);
    process.argv[1] = join(appRoot, 'server.js');
    try {
      stubUnanchoredBoot();
      await expect(register()).rejects.toThrow(/staged merchant pilot assets/);
      expect(registerOTelMock).not.toHaveBeenCalled();
    } finally {
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
      rmSync(appRoot, { force: true, recursive: true });
    }
  });

  it('refuses an unanchored boot with lab on', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    await expect(register()).rejects.toThrow(/cannot anchor/);
    expect(registerOTelMock).not.toHaveBeenCalled();
  });
});
