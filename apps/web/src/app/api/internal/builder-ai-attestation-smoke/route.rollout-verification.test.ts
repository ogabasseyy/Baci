import { describe, expect, it } from 'vitest';
import {
  builderAiAttestationSmokeRunId,
  getBuilderAiAttestationSmokeSeams,
  POST,
  setupBuilderAiAttestationSmokeMocks,
} from './route.test-support';

describe('POST /api/internal/builder-ai-attestation-smoke rollout verification', () => {
  setupBuilderAiAttestationSmokeMocks();

  it('preserves a successful Cerebras provider alias during rollout verification', async () => {
    const seams = getBuilderAiAttestationSmokeSeams();
    seams.bootstrap.mockResolvedValue({
      phase: 'verify',
      runId: builderAiAttestationSmokeRunId,
    });
    seams.materialize.mockReturnValue({
      providers: [{ name: 'cerebras:gemma-4-31b' }],
    });
    seams.smoke.mockResolvedValue([
      { latencyMs: 1, provider: 'cerebras:gemma-4-31b', result: 'pass' },
    ]);

    const response = await POST(
      new Request(
        'https://usebaci.com/api/internal/builder-ai-attestation-smoke',
        { method: 'POST' }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        providers: [
          {
            latencyMs: 1,
            provider: 'cerebras',
            result: 'pass',
          },
        ],
        status: 'verified',
      })
    );
    expect(
      seams.client.mock.results[0]?.value.disableBootstrap
    ).toHaveBeenCalledOnce();
  });
});
