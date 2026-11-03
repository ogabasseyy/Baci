import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Cancel to main and the reconcile/recovery passes must never depend on the
// master kill switch or on the gated new-work readers, or a kill would trap
// customers. Guard the import graph of those modules directly.
const modules = [
  'cancel-plan.ts',
  'customer-cancel-handler.ts',
  'cancellation-recovery.ts',
  'collection-reconciliation.ts',
];
const forbidden = [
  'piggyvest-switches',
  'primary-wallet-runtime',
  'primary-wallet-savings-runtime',
  'primary-wallet-card-checkout-runtime',
  'primary-wallet-inflow-runtime',
  'PIGGYVEST_KILL_SWITCH',
];

describe('cancel to main and reconcile ignore the kill switch', () => {
  it.each(modules)('%s does not reference the gated readers', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    for (const token of forbidden) expect(source).not.toContain(token);
  });
});
