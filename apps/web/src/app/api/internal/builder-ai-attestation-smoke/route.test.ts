import { describe, expect, it, vi } from 'vitest';
import {
  BUILDER_AI_ATTESTATION_MAX_WORK_MS,
  builderAiAttestationSmokeRunId,
  getBuilderAiAttestationSmokeSeams,
  maxDuration,
  POST,
  routeModule,
  setupBuilderAiAttestationSmokeMocks,
} from './route.test-support';

describe('POST /api/internal/builder-ai-attestation-smoke', () => {
  setupBuilderAiAttestationSmokeMocks();
  const seams = () => getBuilderAiAttestationSmokeSeams();

  it('hides disabled requests before any provider or Vercel action', async () => {
    seams().bootstrap.mockResolvedValue(null);
    const response = await POST(
      new Request(
        'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
        { method: 'POST' }
      )
    );
    expect(response.status).toBe(404);
    expect(seams().client).not.toHaveBeenCalled();
    expect(seams().smoke).not.toHaveBeenCalled();
  });

  it('hides a consumed token before provider work or attestation writes', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().client.mockReturnValue({
      claimToken: vi.fn().mockResolvedValue(false),
      disableBootstrap: vi.fn(),
      upsertAttestation: vi.fn(),
    });

    const response = await POST(
      new Request(
        'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
        { method: 'POST' }
      )
    );

    expect(response.status).toBe(404);
    expect(seams().attestation).not.toHaveBeenCalled();
    expect(seams().smoke).not.toHaveBeenCalled();
  });

  it('allows paginated list-delete, provider smoke, and persistence time within route headroom', () => {
    expect(BUILDER_AI_ATTESTATION_MAX_WORK_MS).toBe(62_000);
    expect(BUILDER_AI_ATTESTATION_MAX_WORK_MS).toBeLessThan(maxDuration * 1000);
    expect(maxDuration * 1000).toBeGreaterThan(
      BUILDER_AI_ATTESTATION_MAX_WORK_MS
    );
  });

  it('relies on the cache-components-compatible default runtime and dynamic behavior', () => {
    expect(routeModule).not.toHaveProperty('dynamic');
    expect(routeModule).not.toHaveProperty('runtime');
  });

  it('returns a correlated control-plane failure when the Vercel client is unavailable', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().client.mockReturnValue(null);

    const response = await POST(
      new Request('https://usebaci.com', { method: 'POST' })
    );

    await expect(response.json()).resolves.toEqual({
      code: 'bootstrap_control_unavailable',
      error: 'Builder AI bootstrap failed',
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
  });

  it('claims before smoke then persists only after every provider passes', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    const response = await POST(
      new Request(
        'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
        { method: 'POST' }
      )
    );
    expect(response.status).toBe(200);
    expect(
      seams().client.mock.results[0]?.value.claimToken
    ).toHaveBeenCalledBefore(seams().smoke);
    expect(
      seams().client.mock.results[0]?.value.claimToken
    ).toHaveBeenCalledWith(builderAiAttestationSmokeRunId);
    expect(
      seams().client.mock.results[0]?.value.upsertAttestation
    ).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        phase: 'attest',
        providers: [
          {
            latencyMs: 1,
            provider: 'google',
            result: 'pass',
          },
        ],
        runId: builderAiAttestationSmokeRunId,
        status: 'attested',
      })
    );
  });

  it('does not write tags after a smoke failure and redacts provider details', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().smoke.mockResolvedValue([
      { latencyMs: 1, provider: 'google:gemma-4-31b-it', result: 'fail' },
    ]);
    const response = await POST(
      new Request(
        'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
        { method: 'POST' }
      )
    );
    expect(response.status).toBe(502);
    expect(
      seams().client.mock.results[0]?.value.upsertAttestation
    ).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      code: 'provider_smoke_failed',
      error: 'Builder AI bootstrap failed',
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
  });

  it('fails before provider materialization when attest cannot build both tags', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().attestation.mockReturnValue(null);

    const response = await POST(
      new Request('https://usebaci.com', { method: 'POST' })
    );

    await expect(response.json()).resolves.toEqual({
      code: 'attestation_unavailable',
      error: 'Builder AI bootstrap failed',
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    expect(seams().materialize).not.toHaveBeenCalled();
    expect(seams().smoke).not.toHaveBeenCalled();
  });

  it('returns a correlated failure when no canonical provider can materialize', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().materialize.mockReturnValue({
      providers: [],
    });

    const response = await POST(
      new Request('https://usebaci.com', { method: 'POST' })
    );

    await expect(response.json()).resolves.toEqual({
      code: 'provider_configuration_unavailable',
      error: 'Builder AI bootstrap failed',
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
  });

  it('rejects an unrecognized provider identity without persisting secrets', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().smoke.mockResolvedValue([
      { latencyMs: 1, provider: 'private-model:secret', result: 'pass' },
    ]);

    const response = await POST(
      new Request('https://usebaci.com', { method: 'POST' })
    );

    await expect(response.json()).resolves.toEqual({
      code: 'provider_alias_invalid',
      error: 'Builder AI bootstrap failed',
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    expect(
      seams().client.mock.results[0]?.value.upsertAttestation
    ).not.toHaveBeenCalled();
  });

  it('returns a correlated failure when the final control-plane write fails', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
    seams().client.mockReturnValue({
      claimToken: vi.fn().mockResolvedValue(true),
      disableBootstrap: vi.fn(),
      upsertAttestation: vi.fn().mockResolvedValue(false),
    });

    const response = await POST(
      new Request('https://usebaci.com', { method: 'POST' })
    );

    await expect(response.json()).resolves.toEqual({
      code: 'bootstrap_persistence_failed',
      error: 'Builder AI bootstrap failed',
      phase: 'attest',
      runId: builderAiAttestationSmokeRunId,
    });
  });

  it('uses process environment materialization then disables bootstrap after verify', async () => {
    seams().bootstrap.mockResolvedValue({
      phase: 'verify',
      runId: builderAiAttestationSmokeRunId,
    });
    const response = await POST(
      new Request(
        'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
        { method: 'POST' }
      )
    );

    expect(response.status).toBe(200);
    expect(seams().attestation).not.toHaveBeenCalled();
    expect(seams().materialize).toHaveBeenCalledWith(
      undefined,
      undefined,
      'smoke'
    );
    expect(
      seams().client.mock.results[0]?.value.disableBootstrap
    ).toHaveBeenCalledOnce();
    expect(
      seams().client.mock.results[0]?.value.upsertAttestation
    ).not.toHaveBeenCalled();
  });
});
