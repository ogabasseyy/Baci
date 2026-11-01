import { describe, expect, it } from 'vitest';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';

describe('PRIMARY_WALLET_STATEMENTS', () => {
  it('pins the reviewed onboarding statements', () => {
    expect(PRIMARY_WALLET_STATEMENTS.read).toBe(
      'SELECT piggyvest_primary.read_onboarding($1::jsonb) AS result'
    );
    expect(PRIMARY_WALLET_STATEMENTS.claim).toBe(
      'SELECT piggyvest_primary.claim_onboarding($1::jsonb, $2::text) AS result'
    );
  });

  it('pins the routing-pending statements', () => {
    expect(PRIMARY_WALLET_STATEMENTS.routingPending).toBe(
      'SELECT piggyvest_primary.record_onboarding_routing_pending($1::jsonb, $2::uuid, $3::uuid, $4::text, $5::text, $6::text) AS result'
    );
    expect(PRIMARY_WALLET_STATEMENTS.readRouting).toBe(
      'SELECT piggyvest_primary.read_onboarding_routing($1::jsonb) AS result'
    );
    expect(PRIMARY_WALLET_STATEMENTS.resolveRouting).toBe(
      'SELECT piggyvest_primary.resolve_onboarding_routing($1::jsonb, $2::jsonb, $3::boolean) AS result'
    );
  });

  it('pins the one-step review statement', () => {
    expect(PRIMARY_WALLET_STATEMENTS.review).toBe(
      'SELECT piggyvest_primary.record_onboarding_review($1::jsonb, $2::uuid, $3::uuid, $4::text, $5::text) AS result'
    );
  });

  it('pins the durable ownership-review statements', () => {
    expect(PRIMARY_WALLET_STATEMENTS.ownershipHold).toBe(
      'SELECT piggyvest_primary.record_onboarding_ownership_hold($1::jsonb, $2::uuid, $3::uuid) AS result'
    );
    expect(PRIMARY_WALLET_STATEMENTS.readReview).toBe(
      'SELECT piggyvest_primary.read_onboarding_review($1::jsonb) AS result'
    );
  });

  it('keeps every statement fully parameterized', () => {
    for (const statement of Object.values(PRIMARY_WALLET_STATEMENTS)) {
      expect(statement).toMatch(
        /^SELECT piggyvest_primary\.\w+\(.*\) AS result$/
      );
      expect(statement).not.toMatch(/'\s*\+|\+.*'|\$\{/);
    }
  });
});
