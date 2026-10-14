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
vi.mock('@/config/pilot-public-assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/pilot-public-assets')>()),
  assertPilotPublicAssets: assertPilotPublicAssetsMock,
}));
vi.mock('@/config/pilot-public-assets-roots', () => ({
  resolvePilotPublicDir: resolvePilotPublicDirMock,
}));
vi.mock('@/app/pilot-lab/lab-route', () => ({
  initializeLabRuntime: initializeLabRuntimeMock,
}));
const assertNoUnexpectedStagedFilesMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/merchant-image-variant-pilot/lab-config-stage-guard', () => ({
  assertNoUnexpectedStagedFiles: assertNoUnexpectedStagedFilesMock,
}));
const assertNoUnboundStagedContentMock = vi.hoisted(() => vi.fn());
vi.mock('@/config/pilot-public-assets-triage', () => ({
  assertNoUnboundStagedContent: assertNoUnboundStagedContentMock,
}));
const assertUnanchoredPublicTreesMock = vi.hoisted(() => vi.fn());
vi.mock('@/config/pilot-public-assets-unanchored', () => ({
  assertUnanchoredPublicTrees: assertUnanchoredPublicTreesMock,
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

function anchorError(): Error {
  const error = new Error('cannot anchor the public tree') as Error & {
    code: string;
  };
  error.code = 'PILOT_PUBLIC_UNANCHORED';
  return error;
}

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
  it('degrades to lab-only failure when pilot startup validation fails', async () => {
    // The lab must not take the storefront down: a failed lab init
    // with no unbound staged content logs loudly, skips the runtime
    // publish (lab routes fail closed), and boot completes OTel setup.
    // The staged tree-shape assertion above and the unbound-content
    // check below stay fatal.
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

  it('initializes the enabled pilot before completing registration', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    await register();
    expect(initializeLabRuntimeMock).toHaveBeenCalledOnce();
  });
  it('banners every production lab boot, stays silent in dev', async () => {
    // ALLOW_PROD explicitly opts a production box into serving staged
    // bytes unauthenticated: that must be visible on every boot, so a
    // copied env file can never enable it silently. Dev boots (the
    // normal lab flow) stay quiet.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACI_IMAGE_PILOT_ALLOW_PROD', '1');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(register()).resolves.toBe(undefined);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/LAB ENABLED IN PRODUCTION/);
    } finally {
      warnSpy.mockRestore();
    }
    vi.stubEnv('NODE_ENV', 'development');
    const quietSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(register()).resolves.toBe(undefined);
      expect(quietSpy).not.toHaveBeenCalled();
    } finally {
      quietSpy.mockRestore();
    }
  });
  it('refuses boot when the staged tree drifts from the binding set', async () => {
    // Static-namespace guard: Next serves public/__pilot without
    // invoking lab handlers, so unbound files at boot stay fatal even
    // though lab-runtime init failures degrade.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const stagedPaths = [{ path: '/resolved/public/__pilot/a.png' }];
    initializeLabRuntimeMock.mockResolvedValueOnce({ stagedPaths });
    assertNoUnexpectedStagedFilesMock.mockRejectedValueOnce(
      new Error('staged content drifted — re-stage to reconcile')
    );
    await expect(register()).rejects.toThrow(/drifted/);
    expect(assertNoUnexpectedStagedFilesMock).toHaveBeenCalledWith(
      stagedPaths,
      '/resolved/public/__pilot',
      [
        '/resolved/public/__pilot/fillers/grid-filler-600x400-a.png',
        '/resolved/public/__pilot/fillers/grid-filler-600x400-b.png',
        '/resolved/public/__pilot/fillers/grid-filler-600x400-c.png',
      ]
    );
    expect(registerOTelMock).not.toHaveBeenCalled();
  });

  it('checks the staged binding set after a successful lab init', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const stagedPaths = [{ path: '/resolved/public/__pilot/a.png' }];
    initializeLabRuntimeMock.mockResolvedValueOnce({ stagedPaths });
    assertNoUnexpectedStagedFilesMock.mockResolvedValueOnce(undefined);
    await expect(register()).resolves.toBe(undefined);
    // Filler paths ride along exactly like the request path: without
    // them the boot check never enumerates fillers/, and a fourth
    // file planted there would stay statically servable until the
    // first lab page render — indefinitely if none ever renders.
    expect(assertNoUnexpectedStagedFilesMock).toHaveBeenCalledWith(
      stagedPaths,
      '/resolved/public/__pilot',
      [
        '/resolved/public/__pilot/fillers/grid-filler-600x400-a.png',
        '/resolved/public/__pilot/fillers/grid-filler-600x400-b.png',
        '/resolved/public/__pilot/fillers/grid-filler-600x400-c.png',
      ]
    );
    expect(registerOTelMock).toHaveBeenCalledOnce();
  });

  it('checks candidate trees when unanchored with lab off', async () => {
    // A lab-only feature must not brick unrelated boots on the anchor
    // failure itself: without an anchored root and with the lab off,
    // register checks every candidate tree it can find (fatal on
    // DETECTED staged content) instead of throwing.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    resolvePilotPublicDirMock.mockImplementationOnce(() => {
      throw anchorError();
    });
    await expect(register()).resolves.toBe(undefined);
    expect(assertUnanchoredPublicTreesMock).toHaveBeenCalledOnce();
    expect(registerOTelMock).toHaveBeenCalledOnce();
  });
  it('refuses an unanchored boot with staged content in a candidate tree', async () => {
    // The leniency above is anchor-only: detected staged content in
    // any candidate tree still refuses boot even with the lab off.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    resolvePilotPublicDirMock.mockImplementationOnce(() => {
      throw anchorError();
    });
    assertUnanchoredPublicTreesMock.mockImplementationOnce(() => {
      throw new Error('staged merchant pilot assets require');
    });
    await expect(register()).rejects.toThrow(/staged merchant pilot assets/);
    expect(registerOTelMock).not.toHaveBeenCalled();
  });
  it('propagates an anchored staged-content refusal without degrading', async () => {
    // The catch discriminates by failure: an UNCODED throw from the
    // anchored check (staged content actually detected) must
    // propagate even with the lab off — the candidates path runs only
    // for the coded anchor failure.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    assertPilotPublicAssetsMock.mockImplementationOnce(() => {
      throw new Error('staged merchant pilot assets require');
    });
    await expect(register()).rejects.toThrow(/staged merchant pilot assets/);
    expect(assertUnanchoredPublicTreesMock).not.toHaveBeenCalled();
    expect(registerOTelMock).not.toHaveBeenCalled();
  });
  it('stays fatal when unanchored with lab on', async () => {
    // Lab mode demands a verified tree: an unanchored lab boot refuses
    // instead of inspecting a lookalike.
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    resolvePilotPublicDirMock.mockImplementationOnce(() => {
      throw anchorError();
    });
    await expect(register()).rejects.toThrow(/cannot anchor/);
    expect(assertPilotPublicAssetsMock).not.toHaveBeenCalled();
    expect(registerOTelMock).not.toHaveBeenCalled();
  });
  it('boots the pilot gate against the resolved public dir, never bare cwd', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    // The boot gate must inspect the same tree the build gate did: the
    // shared resolver (config-stashed or standalone-anchored), not a
    // cwd-joined lookalike that diverges under `next start <dir>` or a
    // standalone server run from elsewhere. Unanchored boots take the
    // candidate-tree path tested above.
    expect(resolvePilotPublicDirMock).toHaveBeenCalledOnce();
    expect(assertPilotPublicAssetsMock).toHaveBeenCalledWith(
      '/resolved/public'
    );
  });
});
