import { describe, expect, it } from 'vitest';
import {
  prefundedCardPostgresStatementsForProfile as catalog,
  PREFUNDED_CARD_POSTGRES_STATEMENTS as statements,
} from './prefunded-card-postgres-statements';

describe('first-card statement separation', () => {
  it('keeps customer reservation separate from independently verified promotion', () => {
    expect(catalog('checkout_customer')).toEqual([
      statements.checkoutCapability,
      statements.checkoutReserve,
      statements.checkoutRead,
    ]);
    expect(catalog('checkout_authorizer')).toEqual([
      statements.checkoutClaim,
      statements.checkoutComplete,
      statements.checkoutUncertain,
      statements.checkoutPromote,
      statements.checkoutReconcile,
      statements.checkoutRecoveryCandidates,
    ]);
    expect(catalog('checkout_customer')).not.toContain(
      statements.checkoutPromote
    );
    expect(catalog('checkout_customer')).not.toContain(
      statements.checkoutRecoveryCandidates
    );
    expect(catalog('checkout_authorizer')).not.toContain(
      statements.checkoutReserve
    );
    expect(catalog('checkout_authorizer')).not.toContain(
      statements.checkoutRead
    );
  });

  it('does not add checkout proof writes to existing public or worker profiles', () => {
    for (const profile of [
      'customer',
      'worker',
      'authorizer',
      'evidence',
      'reversal',
    ]) {
      for (const entry of catalog(profile))
        expect(entry.text).not.toContain('prefunded_card.checkout_');
    }
    for (const profile of ['checkout_customer', 'checkout_authorizer']) {
      expect(catalog(profile)).not.toContain(statements.claimCollection);
      expect(catalog(profile)).not.toContain(statements.recordCollection);
      expect(catalog(profile)).not.toContain(statements.provisionAuthorization);
    }
  });

  it('pins the exact parameterized function signatures', () => {
    for (const [entry, arity] of [
      [statements.checkoutReserve, 2],
      [statements.checkoutRead, 2],
      [statements.checkoutClaim, 2],
      [statements.checkoutComplete, 4],
      [statements.checkoutUncertain, 3],
      [statements.checkoutPromote, 3],
      [statements.checkoutReconcile, 2],
    ] as const) {
      expect(entry.parameters).toHaveLength(arity);
      expect(entry.text.match(/\$\d+::jsonb/g)).toHaveLength(arity);
      expect(entry.text).not.toContain(';');
    }
    expect(statements.checkoutCapability.parameters).toHaveLength(5);
    expect(statements.checkoutCapability.text).toBe(
      'SELECT prefunded_card.checkout_capability($1::jsonb,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS result'
    );
  });
});
