import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

// Pilot boot-gate cases, split from instrumentation.test.ts under the
// repo line ceiling: staged-asset refusal, lab validation, and the
// resolved-public-dir binding register() enforces before services.
const registerOTelMock = vi.hoisted(() => vi.fn());
const initializeLabRuntimeMock = vi.hoisted(() => vi.fn());
const assertPilotPublicAssetsMock = vi.hoisted(() => vi.fn());
const resolvePilotPublicDirMock = vi.hoisted(() =>
  vi.fn(() => '/resolved/public')
);
vi.mock('@/config/pilot-public-assets', () => ({
  assertPilotPublicAssets: assertPilotPublicAssetsMock,
  resolvePilotPublicDir: resolvePilotPublicDirMock,
}));
vi.mock('@/app/pilot-lab/lab-route', () => ({
  initializeLabRuntime: initializeLabRuntimeMock,
}));
const captureServerExceptionMock = vi.hoisted(() => vi.fn());
const captureServerEventMock = vi.hoisted(() => vi.fn());
const setRateLimitDiagnosticHookMock = vi.hoisted(() => vi.fn());

vi.mock('@vercel/otel', () => ({
  registerOTel: registerOTelMock,
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
  captureServerException: captureServerExceptionMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  setRateLimitDiagnosticHook: setRateLimitDiagnosticHookMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
  vi.stubEnv('NEXT_OTEL_FETCH_DISABLED', '0');
});

describe('instrumentation pilot boot gate', () => {
  it('rejects non-lab startup with staged public assets before registering services', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    assertPilotPublicAssetsMock.mockImplementationOnce(() => {
      throw new Error('staged merchant pilot assets');
    });
    await expect(register()).rejects.toThrow('staged merchant pilot assets');
    expect(registerOTelMock).not.toHaveBeenCalled();
    expect(initializeLabRuntimeMock).not.toHaveBeenCalled();
  });
  it('awaits pilot startup validation and rejects boot on invalid staged inputs', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    initializeLabRuntimeMock.mockRejectedValueOnce(
      new Error('invalid staged inputs')
    );
    await expect(register()).rejects.toThrow('invalid staged inputs');
    expect(registerOTelMock).not.toHaveBeenCalled();
  });

  it('initializes the enabled pilot before completing registration', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    await register();
    expect(initializeLabRuntimeMock).toHaveBeenCalledOnce();
  });
  it('boots the pilot gate against the resolved public dir, never bare cwd', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    // The boot gate must inspect the same tree the build gate did: the
    // shared resolver (config-stashed, standalone-anchored, or cwd),
    // not a cwd-joined lookalike that diverges under `next start <dir>`
    // or a standalone server run from elsewhere.
    expect(resolvePilotPublicDirMock).toHaveBeenCalledOnce();
    expect(assertPilotPublicAssetsMock).toHaveBeenCalledWith(
      '/resolved/public'
    );
  });
});
