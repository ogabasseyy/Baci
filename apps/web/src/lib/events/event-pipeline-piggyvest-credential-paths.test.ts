import { describe, expect, it } from 'vitest';
import { eventPipelinePiggyvestCredentialPaths } from './event-pipeline-piggyvest-credential-paths';

describe('eventPipelinePiggyvestCredentialPaths', () => {
  it('pins the five reviewed credential chains', () => {
    expect(eventPipelinePiggyvestCredentialPaths).toHaveLength(5);
    for (const chain of eventPipelinePiggyvestCredentialPaths) {
      expect(chain[chain.length - 1]).toBe('apps/web/src/env.ts');
    }
  });

  it('keeps direct env edges on HMAC/API routes only', () => {
    const direct = eventPipelinePiggyvestCredentialPaths.filter(
      (chain) => chain.length === 2
    );
    expect(direct.map(([route]) => route).sort()).toEqual([
      'apps/web/src/app/api/storefront/customer/wallet/piggyvest-plan/route.ts',
      'apps/web/src/app/api/webhooks/piggyvest/route.ts',
    ]);
  });
});
