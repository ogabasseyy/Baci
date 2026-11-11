// @vitest-environment node
import { expect, it } from 'vitest';
import { cartSetupSql } from './cart-engine-fixture';

it('assembles only the trusted pre-submission engine fixture and leaves order calls unexecuted', () => {
  const sql = cartSetupSql();
  expect(sql).not.toContain('-- 7. Bound submission');
  expect(sql).not.toContain('-- 1. Prepare creates');
  const withoutDefinitions = sql.replace(
    /CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$;/gi,
    ''
  );
  expect(withoutDefinitions).not.toMatch(
    /(?:SELECT|PERFORM)\s+(?:public\.)?create_storefront_order/i
  );
  expect(sql.trimEnd()).toMatch(/COMMIT;$/);
});
