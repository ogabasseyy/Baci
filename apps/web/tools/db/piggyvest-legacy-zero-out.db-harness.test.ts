import { describe, expect, it } from 'vitest';
import { C1, M, W1 } from './piggyvest-legacy-runbook.db-support';
import {
  makeHarness,
  row,
  zeroSql,
} from './piggyvest-legacy-zero-out.db-harness';

describe('zero-out db harness', () => {
  it('formats a reviewed list row with the default reference', () => {
    expect(row(W1, C1, '500.00')).toBe(
      `('${W1}','${M}','${C1}',500.00,'PV-REF-500.00')`
    );
  });

  it('formats a row with an explicit reference', () => {
    expect(row(W1, C1, '1.00', 'PV-X')).toContain(`'PV-X')`);
  });

  it('loads the committed script that still holds the empty-list marker', () => {
    expect(zeroSql).toContain('-- <<< REVIEWED ROWS ABOVE');
  });

  it('does not touch the scratch database until a helper is used', () => {
    let reads = 0;
    makeHarness(() => {
      reads += 1;
      throw new Error('scratch must not be read eagerly');
    });
    expect(reads).toBe(0);
  });
});
