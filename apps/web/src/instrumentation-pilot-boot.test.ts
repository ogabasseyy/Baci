import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPilotStartupGate } from './instrumentation-pilot-boot';

const assertPilotPublicAssetsMock = vi.hoisted(() => vi.fn());
const pinnedFillerEntriesMock = vi.hoisted(() =>
  vi.fn(() => [{ path: '/resolved/public/__pilot/fillers/a.avif' }])
);
const resolvePilotPublicDirMock = vi.hoisted(() =>
  vi.fn(() => '/resolved/public')
);
const assertNoUnboundStagedContentMock = vi.hoisted(() => vi.fn());
const isPilotLabEnabledMock = vi.hoisted(() => vi.fn(() => false));
const hasPilotIntentMock = vi.hoisted(() => vi.fn(() => true));
const assertUnanchoredPublicTreesMock = vi.hoisted(() => vi.fn());
const initializeLabRuntimeMock = vi.hoisted(() => vi.fn());
const assertNoUnexpectedStagedFilesMock = vi.hoisted(() => vi.fn());

vi.mock('@/config/pilot-public-assets', () => ({
  assertPilotPublicAssets: assertPilotPublicAssetsMock,
  pinnedFillerEntries: pinnedFillerEntriesMock,
}));

vi.mock('@/config/pilot-public-assets-roots', () => ({
  assertNoUnboundStagedContent: assertNoUnboundStagedContentMock,
  resolvePilotPublicDir: resolvePilotPublicDirMock,
}));

vi.mock('@/config/pilot-lab-enabled', () => ({
  PILOT_LAB_ALLOW_PROD_FLAG: 'BACI_IMAGE_PILOT_ALLOW_PROD',
  isPilotLabEnabled: isPilotLabEnabledMock,
}));

vi.mock('@/config/pilot-public-assets-unanchored', () => ({
  assertUnanchoredPublicTrees: assertUnanchoredPublicTreesMock,
  hasPilotIntent: hasPilotIntentMock,
}));

vi.mock('@/app/pilot-lab/lab-route', () => ({
  initializeLabRuntime: initializeLabRuntimeMock,
}));

vi.mock('@/lib/merchant-image-variant-pilot/lab-config-stage-guard', () => ({
  assertNoUnexpectedStagedFiles: assertNoUnexpectedStagedFilesMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  isPilotLabEnabledMock.mockReturnValue(false);
  hasPilotIntentMock.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('registerPilotStartupGate', () => {
  it('checks the anchored public directory when lab mode is disabled', async () => {
    await registerPilotStartupGate();
    expect(assertPilotPublicAssetsMock).toHaveBeenCalledWith(
      '/resolved/public',
      undefined,
      'throw'
    );
    expect(initializeLabRuntimeMock).not.toHaveBeenCalled();
  });

  it('initializes the lab runtime and verifies staged files when enabled', async () => {
    isPilotLabEnabledMock.mockReturnValue(true);
    const stagedPaths = new Set(['/resolved/public/__pilot/tier.avif']);
    initializeLabRuntimeMock.mockResolvedValueOnce({ stagedPaths });

    await registerPilotStartupGate();

    expect(initializeLabRuntimeMock).toHaveBeenCalledOnce();
    expect(assertNoUnexpectedStagedFilesMock).toHaveBeenCalledWith(
      stagedPaths,
      '/resolved/public/__pilot',
      ['/resolved/public/__pilot/fillers/a.avif']
    );
  });
});
