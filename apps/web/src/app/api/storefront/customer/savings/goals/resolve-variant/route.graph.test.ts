import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectProductionImportClosure } from '@/lib/events/event-pipeline-import-closure';
import { readGitSourceSnapshot } from '../../../../../../../../tools/events/event-pipeline-git-source-snapshot';

describe('nonpayment variant selection import graph', () => {
  it('cannot reach savings payment credentials, VTU or Kuda', () => {
    const root = resolve(process.cwd(), '../..');
    const sources = readGitSourceSnapshot(root).filesystemSources;
    const closure = collectProductionImportClosure(
      [
        'apps/web/src/app/api/storefront/customer/savings/goals/resolve-variant/route.ts',
      ],
      sources
    );
    expect(closure.size).toBeGreaterThan(1);
    for (const forbidden of [
      'apps/web/src/app/api/storefront/customer/savings/shared.ts',
      'apps/web/src/lib/vtu-pending-transaction.ts',
      'apps/web/src/lib/kuda.ts',
      'apps/web/src/lib/fetch-merchant-payment-secret.ts',
    ])
      expect(closure.has(forbidden), forbidden).toBe(false);
    const nonpaymentClosure = collectProductionImportClosure(
      [
        'apps/web/src/lib/customer-savings-nonpayment-context.ts',
        'apps/web/src/lib/customer-savings-nonpayment-settings.ts',
      ],
      sources
    );
    expect(nonpaymentClosure.has('apps/web/src/env.ts')).toBe(false);
  });
});
