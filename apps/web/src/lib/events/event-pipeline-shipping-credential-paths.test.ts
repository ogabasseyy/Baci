import { describe, expect, it } from 'vitest';
import { eventPipelineShippingCredentialPaths } from './event-pipeline-shipping-credential-paths';

describe('eventPipelineShippingCredentialPaths', () => {
  it('allows only the audited shipping quote proof credential paths', () => {
    expect(eventPipelineShippingCredentialPaths).toHaveLength(23);
    expect(eventPipelineShippingCredentialPaths).toContainEqual([
      'apps/web/src/lib/shipping/shipping-quote-route-proof.ts',
      'apps/web/src/env.ts',
    ]);
  });
});
