import { describe, expect, it } from 'vitest';

import {
  PREFUNDED_CARD_POSTGRES_STATEMENTS,
  prefundedCardPostgresStatementsForProfile,
} from './prefunded-card-postgres-statements';

describe('prefunded card postgres statements', () => {
  it('keeps every profile limited to its fixed callable surface', () => {
    expect(prefundedCardPostgresStatementsForProfile('customer')).toEqual([
      PREFUNDED_CARD_POSTGRES_STATEMENTS.customerCapabilities,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.customerRequest,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.customerStatus,
    ]);
    expect(prefundedCardPostgresStatementsForProfile('customer')).not.toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.claimDue
    );
    expect(prefundedCardPostgresStatementsForProfile('authorizer')).toEqual([
      PREFUNDED_CARD_POSTGRES_STATEMENTS.connectionReady,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.authorizationCandidate,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.provisionAuthorization,
    ]);
    expect(prefundedCardPostgresStatementsForProfile('evidence')).toEqual([
      PREFUNDED_CARD_POSTGRES_STATEMENTS.connectionReady,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.evidenceScope,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.recordProviderEvidence,
      PREFUNDED_CARD_POSTGRES_STATEMENTS.evidenceDestinationMapping,
    ]);
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.readAuthorization
    );
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.readTransferEvidence
    );
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.classifyProviderInflow
    );
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.applyClassifiedInflow
    );
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.readReversalContext
    );
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.recordCollectionReversal
    );
    expect(prefundedCardPostgresStatementsForProfile('worker')).not.toContain(
      PREFUNDED_CARD_POSTGRES_STATEMENTS.provisionAuthorization
    );
  });

  it('defines a typed fixed arity for every registered statement', () => {
    for (const statement of Object.values(PREFUNDED_CARD_POSTGRES_STATEMENTS)) {
      if (statement === PREFUNDED_CARD_POSTGRES_STATEMENTS.connectionReady) {
        expect(statement.text).toBe('SELECT true AS result');
        expect(statement.parameters).toHaveLength(0);
        continue;
      }
      expect(statement.text).toMatch(/^SELECT prefunded_card\./);
      expect(statement.text).not.toContain(';');
      expect(statement.parameters.length).toBeGreaterThan(0);
    }
  });

  it('allows all three runtime readiness profiles to run only the exact parameterless probe', () => {
    const probe = PREFUNDED_CARD_POSTGRES_STATEMENTS.connectionReady;
    for (const profile of ['worker', 'authorizer', 'evidence'])
      expect(prefundedCardPostgresStatementsForProfile(profile)).toContain(
        probe
      );
    for (const profile of [
      'customer',
      'reversal',
      'checkout_customer',
      'checkout_authorizer',
    ])
      expect(prefundedCardPostgresStatementsForProfile(profile)).not.toContain(
        probe
      );
    expect(probe.text).toBe('SELECT true AS result');
    expect(probe.parameters).toEqual([]);
  });

  it('keeps customer capability reads on the exact eight-argument customer surface', () => {
    const statement = PREFUNDED_CARD_POSTGRES_STATEMENTS.customerCapabilities;
    expect(statement.text).toBe(
      'SELECT prefunded_card.customer_capabilities($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result'
    );
    expect(statement.parameters).toHaveLength(8);
    expect(prefundedCardPostgresStatementsForProfile('customer')).toContain(
      statement
    );
    for (const profile of ['worker', 'authorizer', 'evidence', 'reversal'])
      expect(prefundedCardPostgresStatementsForProfile(profile)).not.toContain(
        statement
      );
  });

  it('limits routing lookup to the worker with an exact bounded hints parameter', () => {
    const statement =
      PREFUNDED_CARD_POSTGRES_STATEMENTS.resolveReplayEnrollment;
    expect(prefundedCardPostgresStatementsForProfile('worker')).toContain(
      statement
    );
    for (const profile of ['customer', 'authorizer', 'evidence', 'reversal'])
      expect(prefundedCardPostgresStatementsForProfile(profile)).not.toContain(
        statement
      );
    expect(statement.text).toBe(
      'SELECT prefunded_card.resolve_replay_enrollment($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::jsonb) AS result'
    );
    expect(statement.parameters).toHaveLength(7);
    expect(statement.parameters[6].safeParse('{}').success).toBe(false);
    expect(statement.parameters[6].safeParse('a'.repeat(16_385)).success).toBe(
      false
    );
  });
});
