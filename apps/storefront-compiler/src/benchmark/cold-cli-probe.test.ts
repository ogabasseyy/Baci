import { describe, expect, it } from 'vitest';
import { measureColdCliProcessSamples } from './cold-cli-probe';
import { createOgabasseyStorefrontManifest } from './ogabassey-catalog-fixture';

describe('cold-cli-probe', () => {
  it('measures positive wall-clock cold CLI process compile durations', async () => {
    const samples = await measureColdCliProcessSamples(
      JSON.stringify(createOgabasseyStorefrontManifest()),
      1
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]).toBeGreaterThan(0);
  });
});
