import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

// Degraded-boot cases, split from instrumentation-pilot.test.ts under
// the repo line ceiling: lab-init failure degrades to a lab-only
// failure, unbound staged content refuses, and ALLOW_PROD refuses.
const registerOTelMock = vi.hoisted(() => vi.fn());
const initializeLabRuntimeMock = vi.hoisted(() => vi.fn());
const assertPilotPublicAssetsMock = vi.hoisted(() => vi.fn());
const resolvePilotPublicDirMock = vi.hoisted(() =>
  vi.fn(() => '/resolved/public')
);
vi.mock('@/config/pilot-public-assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/pilot-public-assets')>()),
  assertPilotPublicAssets: assertPilotPublicAssetsMock,
}));
const assertNoUnboundStagedContentMock = vi.hoisted(() => vi.fn());
const hasPilotIntentMock = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/config/pilot-public-assets-roots', () => ({
  assertNoUnboundStagedContent: assertNoUnboundStagedContentMock,
  resolvePilotPublicDir: resolvePilotPublicDirMock,
}));
const assertUnanchoredPublicTreesMock = vi.hoisted(() => vi.fn());
vi.mock('@/config/pilot-public-assets-unanchored', () => ({
  assertUnanchoredPublicTrees: assertUnanchoredPublicTreesMock,
  hasPilotIntent: hasPilotIntentMock,
}));
vi.mock('@/app/pilot-lab/lab-route', () => ({
  initializeLabRuntime: initializeLabRuntimeMock,
}));
const assertNoUnexpectedStagedFilesMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/merchant-image-variant-pilot/lab-config-stage-guard', () => ({
  assertNoUnexpectedStagedFiles: assertNoUnexpectedStagedFilesMock,
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

describe('instrumentation degraded boot', () => {
  it('degrades to lab-only failure when pilot startup validation fails', async () => {
    // The lab must not take the storefront down: a failed lab init
    // with no unbound staged content logs loudly, skips the runtime
    // publish (lab routes fail closed), and boot completes OTel setup.
    // The drift assertion and the unbound-content check stay fatal.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    initializeLabRuntimeMock.mockRejectedValueOnce(
      new Error('invalid staged inputs')
    );
    const errors: unknown[][] = [];
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
    await expect(register()).resolves.toBe(undefined);
    expect(registerOTelMock).toHaveBeenCalledOnce();
    expect(assertNoUnboundStagedContentMock).toHaveBeenCalledWith(
      '/resolved/public'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toMatch(/lab runtime initialization failed/);
    expect(errors[0][1]).toMatchObject({ message: 'invalid staged inputs' });
    errorSpy.mockRestore();
  });
  it('refuses boot when lab init fails with staged content present', async () => {
    // Failed init means no binding set — but Next still serves
    // public/__pilot statically, so unbound staged content refuses
    // boot instead of degrading into silent exposure.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    initializeLabRuntimeMock.mockRejectedValueOnce(
      new Error('invalid staged inputs')
    );
    assertNoUnboundStagedContentMock.mockImplementationOnce(() => {
      throw new Error('1 unbound entry under __pilot');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(register()).rejects.toThrow(/unbound entry/);
    expect(registerOTelMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
  it('refuses a degraded boot when ALLOW_PROD is set, even with no staged content', async () => {
    // Production exposure acknowledged means direct /__pilot fetches
    // serve with NO re-check until restart after a failed init — so
    // the degraded boot is fatal here instead of fail-loud, and the
    // original init error propagates (most informative). Lab-dev
    // without the flag keeps the degrade above.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_ALLOW_PROD', '1');
    initializeLabRuntimeMock.mockRejectedValueOnce(
      new Error('invalid staged inputs')
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(register()).rejects.toThrow(/invalid staged inputs/);
    expect(registerOTelMock).not.toHaveBeenCalled();
    expect(assertNoUnboundStagedContentMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
