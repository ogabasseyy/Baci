import { beforeEach, vi } from 'vitest';

const builderAiAttestationSmokeSeams = vi.hoisted(() => ({
  attestation: vi.fn(),
  bootstrap: vi.fn(),
  client: vi.fn(),
  materialize: vi.fn(),
  smoke: vi.fn(),
}));

vi.mock('@/lib/builder-ai/create-builder-ai-bootstrap-attestation', () => ({
  createBuilderAiBootstrapAttestation:
    builderAiAttestationSmokeSeams.attestation,
}));
vi.mock('@/lib/builder-ai/get-builder-ai-bootstrap-request', () => ({
  getBuilderAiBootstrapRequest: builderAiAttestationSmokeSeams.bootstrap,
}));
vi.mock('@/lib/builder-ai/materialize-builder-ai-provider-chain', () => ({
  materializeBuilderAiProviderChain: builderAiAttestationSmokeSeams.materialize,
}));
vi.mock('@/lib/builder-ai/smoke-builder-ai-bootstrap-providers', () => ({
  smokeBuilderAiBootstrapProviders: builderAiAttestationSmokeSeams.smoke,
}));
vi.mock('@/lib/builder-ai/vercel-builder-ai-bootstrap', () => ({
  createBuilderAiVercelBootstrapClient: builderAiAttestationSmokeSeams.client,
}));

export const builderAiAttestationSmokeRunId =
  '11111111-1111-4111-8111-111111111111';

export function getBuilderAiAttestationSmokeSeams() {
  return builderAiAttestationSmokeSeams;
}

export function setupBuilderAiAttestationSmokeMocks() {
  beforeEach(() => {
    vi.clearAllMocks();
    builderAiAttestationSmokeSeams.client.mockReturnValue({
      claimToken: vi.fn().mockResolvedValue(true),
      disableBootstrap: vi.fn().mockResolvedValue(true),
      upsertAttestation: vi.fn().mockResolvedValue(true),
    });
    builderAiAttestationSmokeSeams.attestation.mockReturnValue({
      environment: { GOOGLE_GENAI_API_KEY: 'secret' },
      values: { BUILDER_AI_PROVIDER_BINDING_PEPPER: 'secret' },
    });
    builderAiAttestationSmokeSeams.materialize.mockReturnValue({
      providers: [{ name: 'google:gemma-4-31b-it' }],
    });
    builderAiAttestationSmokeSeams.smoke.mockResolvedValue([
      { latencyMs: 1, provider: 'google:gemma-4-31b-it', result: 'pass' },
    ]);
  });
}

export const routeModule = await import('./route');
export const { BUILDER_AI_ATTESTATION_MAX_WORK_MS, maxDuration, POST } =
  routeModule;
