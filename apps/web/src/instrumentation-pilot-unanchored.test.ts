import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

// Unanchored-boot tests against the REAL public-assets resolver (the
// mocked suite cannot exercise the anchor throw path): with the lab
// off, a boot whose public tree cannot be anchored must warn and
// complete — never brick an unrelated server.
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

describe('instrumentation unanchored boot', () => {
  it('warns and completes with lab off and an app-root cwd', async () => {
    // Sandbox cwd WITH a public/ dir: plausibly the served app root,
    // so the degraded cwd check runs (finding nothing to refuse) and
    // boot completes with the loud anchor warning.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-'));
    mkdirSync(join(sandbox, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
      vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
      vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/cannot anchor/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('refuses with lab off when the cwd is provably not the app root', async () => {
    // Bare sandbox cwd (no public/, no next.config.*): the served tree
    // lives elsewhere unseen and may hold staged content, so even a
    // lab-off boot refuses instead of passing a lookalike.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
      vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
      vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
      await expect(register()).rejects.toThrow(/not a Next app root/);
      expect(registerOTelMock).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
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
