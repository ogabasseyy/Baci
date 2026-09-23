import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');

describe('repair pickup payment webhook wiring', () => {
  it('dispatches verified payments before generic payment matching', () => {
    expect(source).toContain(
      "import { dispatchRepairPickupPayment } from '@/lib/repairs/dispatch-repair-pickup-payment';"
    );

    const amountGuard = source.indexOf('const verifiedAmount =');
    const repairDispatch = source.indexOf(
      'await dispatchRepairPickupPayment({'
    );
    const genericMatching = source.indexOf(
      'let resolvedAgenticTransaction:',
      amountGuard
    );

    expect(amountGuard).toBeGreaterThan(-1);
    expect(repairDispatch).toBeGreaterThan(amountGuard);
    expect(repairDispatch).toBeLessThan(genericMatching);
    expect(source).toContain('verifiedAmount: verifiedAmount.amount');
  });
});
