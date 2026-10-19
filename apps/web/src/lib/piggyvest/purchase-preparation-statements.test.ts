import { expect, it } from 'vitest';
import { PURCHASE_PREPARATION_STATEMENTS } from './purchase-preparation-statements';

it('exposes only three exact restricted local operations without publishing or settlement', () => {
  expect(Object.keys(PURCHASE_PREPARATION_STATEMENTS)).toEqual([
    'purchaseQuote',
    'purchasePrepare',
    'purchaseStatus',
  ]);
  for (const statement of Object.values(PURCHASE_PREPARATION_STATEMENTS)) {
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text.match(/\$\d+/g)).toHaveLength(statement.parameters);
    expect(statement.text).not.toMatch(/dispatch|settle|release|publish/);
  }
});
