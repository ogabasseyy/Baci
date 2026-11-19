import { describe, expect, it } from 'vitest';
import { vpsCronWorkerAuthority } from './event-pipeline-vps-cron-worker-paths';

describe('vpsCronWorkerAuthority', () => {
  it('registers Phase 4 VPS cron worker scripts and authority chains', () => {
    expect(vpsCronWorkerAuthority.adminImporters).toContain(
      'apps/web/src/scripts/reconcile-vtu-processing.ts'
    );
    expect(vpsCronWorkerAuthority.adminImporters).toContain(
      'apps/web/src/scripts/purge-jumia-self-authorization-discoveries.ts'
    );
    expect(vpsCronWorkerAuthority.adminImporters).toContain(
      'apps/web/src/scripts/cleanup-checkout-shipping-recovery-previews.ts'
    );
    expect(vpsCronWorkerAuthority.serviceImporters).toHaveLength(3);
    expect(vpsCronWorkerAuthority.adminPaths.length).toBeGreaterThan(0);
    expect(vpsCronWorkerAuthority.credentialPaths.length).toBeGreaterThan(0);
  });
});
