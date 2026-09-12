import { describe, expect, it } from 'vitest';
import {
  builderAiAttestationSmokeRunId,
  getBuilderAiAttestationSmokeSeams,
  POST,
  routeModule,
  setupBuilderAiAttestationSmokeMocks,
} from './route.test-support';

describe('builder AI attestation smoke route test support', () => {
  setupBuilderAiAttestationSmokeMocks();

  it('exposes stable route exports and a fixed smoke run id', () => {
    expect(builderAiAttestationSmokeRunId).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(typeof POST).toBe('function');
    expect(routeModule).toHaveProperty('POST', POST);
  });

  it('returns hoisted seam mocks that reset to authenticated defaults', async () => {
    const seams = getBuilderAiAttestationSmokeSeams();
    expect(seams.attestation).toBeTypeOf('function');
    expect(seams.bootstrap).toBeTypeOf('function');
    expect(seams.client).toBeTypeOf('function');
    expect(seams.materialize).toBeTypeOf('function');
    expect(seams.smoke).toBeTypeOf('function');

    const client = seams.client();
    expect(client.claimToken).toBeTypeOf('function');
    await expect(client.claimToken()).resolves.toBe(true);
    expect(seams.attestation()).toEqual({
      environment: { GOOGLE_GENAI_API_KEY: 'secret' },
      values: { BUILDER_AI_PROVIDER_BINDING_PEPPER: 'secret' },
    });
    expect(seams.materialize()).toEqual({
      providers: [{ name: 'google:gemma-4-31b-it' }],
    });
    await expect(seams.smoke()).resolves.toEqual([
      { latencyMs: 1, provider: 'google:gemma-4-31b-it', result: 'pass' },
    ]);
  });

  it('clears seam call history between tests', async () => {
    const seams = getBuilderAiAttestationSmokeSeams();
    seams.bootstrap.mockResolvedValueOnce({ phase: 'attest', runId: 'run-1' });
    await seams.bootstrap();
    expect(seams.bootstrap).toHaveBeenCalledOnce();
  });
});

describe('builder AI attestation smoke route test support isolation', () => {
  setupBuilderAiAttestationSmokeMocks();

  it('starts with a clean bootstrap seam after the prior test', () => {
    expect(
      getBuilderAiAttestationSmokeSeams().bootstrap
    ).not.toHaveBeenCalled();
  });
});
