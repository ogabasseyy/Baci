import { describe, expect, it } from 'vitest';
import { redvaultTestQuote } from './redvault-test-fixture';

describe('REDVAULT checkout fixture integrity', () => {
  it('reconciles unit allocations, grouped members, and quote totals', () => {
    const quote = redvaultTestQuote;
    expect(quote.productSubtotalKobo).toBe(
      quote.lines.reduce(
        (total, line) => total + line.unitPriceKobo * line.quantity,
        0
      )
    );
    expect(quote.discountKobo).toBe(
      quote.lines.reduce((total, line) => total + line.discountKobo, 0)
    );
    expect(quote.eligibleSubtotalKobo).toBe(
      quote.groups.reduce((total, group) => total + group.lineSubtotalKobo, 0)
    );
    for (const line of quote.lines) {
      expect(line.unitDiscountsKobo).toHaveLength(line.quantity);
      expect(
        line.unitDiscountsKobo.reduce((total, amount) => total + amount, 0)
      ).toBe(line.discountKobo);
      const members = quote.groups
        .flatMap((group) => group.members)
        .filter((member) => member.lineId === line.lineId);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        quantity: line.quantity,
        allocationKobo: line.discountKobo,
      });
    }
    for (const group of quote.groups) {
      expect(
        group.members.reduce(
          (total, member) => total + member.allocationKobo,
          0
        )
      ).toBe(group.discountKobo);
      expect(group.discountKobo).toBe((group.lineSubtotalKobo * 10) / 100);
    }
  });
});
