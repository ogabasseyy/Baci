import { describe, expect, it } from 'vitest';
import { PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS } from './transfer-outbox-finality-statements';

function placeholderCount(text: string): number {
  return new Set(text.match(/\$\d+/g) ?? []).size;
}

describe('PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS', () => {
  it('matches placeholder counts to declared parameters', () => {
    for (const statement of Object.values(
      PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS
    )) {
      expect(placeholderCount(statement.text)).toBe(statement.parameters);
    }
  });

  it('reads through the scoped finality view', () => {
    expect(PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected.text).toContain(
      'read_piggyvest_transfer_outbox_finality_scoped'
    );
  });
});
