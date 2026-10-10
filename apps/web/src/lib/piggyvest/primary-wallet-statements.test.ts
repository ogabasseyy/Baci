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

  it('keeps every statement fully parameterized', () => {
    for (const statement of Object.values(PRIMARY_WALLET_STATEMENTS)) {
      expect(statement).toMatch(
        /^SELECT piggyvest_primary\.\w+\(.*\) AS result$/
      );
      expect(statement).not.toMatch(/'\s*\+|\+.*'|\$\{/);
    }
  });
});
