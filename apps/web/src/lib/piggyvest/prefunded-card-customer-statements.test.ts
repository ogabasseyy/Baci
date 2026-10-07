import { expect, it } from 'vitest';
import { PREFUNDED_CARD_CUSTOMER_STATEMENTS as statements } from './prefunded-card-customer-statements';

it('keeps capability, reservation and status as distinct eight-parameter RPCs', () => {
  expect(statements.capabilities).toBe(
    'SELECT prefunded_card.customer_capabilities($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result'
  );
  expect(new Set(Object.values(statements)).size).toBe(3);
  for (const statement of Object.values(statements)) {
    expect(statement.match(/\$[1-8]::/g)).toHaveLength(8);
    expect(statement).not.toContain(';');
  }
});
