import { describe, expect, it } from 'vitest';
import { isMissingSchemaColumn } from './is-missing-transaction-review-schema-column';

describe('isMissingSchemaColumn', () => {
  it('matches the requested column in a schema-cache error', () => {
    const error = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };

    expect(isMissingSchemaColumn(error, 'variant_attributes')).toBe(true);
  });

  it('does not match a different column or a non-schema error', () => {
    const schemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_attributes' column of 'order_items' in the schema cache",
    };
    const queryError = {
      code: 'PGRST116',
      message: 'The result contains 0 rows',
    };

    expect(isMissingSchemaColumn(schemaError, 'discount_code_id')).toBe(false);
    expect(isMissingSchemaColumn(queryError, 'variant_attributes')).toBe(false);
    expect(isMissingSchemaColumn(null, 'variant_attributes')).toBe(false);
  });
});
