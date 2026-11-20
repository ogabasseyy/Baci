// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({
  integration: vi.fn(),
  build: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('./production-integration', () => ({
  createProductionExperienceIntegration: f.integration,
}));
vi.mock('../../../tools/experience-verifier/build-client', () => ({
  createVerifierBuildClient: f.build,
}));
vi.mock('../../../tools/experience-verifier/capture-client', () => ({
  createVerifierCaptureClient: f.capture,
}));

import { createProductionBuilderPorts } from './production-builder-ports';

it('uses remote verification for both build and preview without a local evidence writer', () => {
  const remoteBuild = vi.fn();
  const remoteCapture = vi.fn();
  f.build.mockReturnValue(remoteBuild);
  f.capture.mockReturnValue(remoteCapture);
  f.integration.mockReturnValue({});
  const linked = vi.fn();
  createProductionBuilderPorts({
    signingKey: {} as never,
    broker: { readConnection: vi.fn(), resolveLinkedAccessToken: linked },
    supabase: { url: 'https://synthetic.supabase.co', anonKey: 'synthetic' },
    buildVerifier: { key: new Uint8Array(32), port: 8891 },
    integration: {
      hostOrigin: 'https://builder.baci.test',
      build: {
        key: new Uint8Array(32),
        toolchainDigest: 'a'.repeat(64),
        transient: {},
      },
    } as never,
  } as never);
  expect(f.integration).toHaveBeenCalledWith(
    expect.objectContaining({
      remoteCapture,
      build: expect.objectContaining({ recordVerifiedEvidence: remoteBuild }),
    })
  );
  expect(f.capture).toHaveBeenCalledWith(
    expect.objectContaining({
      previewOrigin: 'https://builder.baci.test',
      resolveLinkedAccessToken: linked,
    })
  );
});
