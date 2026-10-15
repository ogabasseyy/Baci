import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSqlFunctionDefinition } from './extract-sql-function-definition.mjs';
import { createShippingQuoteProofTestDatabase } from './shipping-quote-proof-postgres-test-harness.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '../migrations');
function definition(name, schema, functionName) {
  return extractSqlFunctionDefinition(
    readFileSync(resolve(migrations, name), 'utf8'),
    schema,
    functionName
  );
}
export function createCustomerCheckoutShippingRecoveryTestDatabase({
  beforeFix = false,
} = {}) {
  const database = createShippingQuoteProofTestDatabase();
  return {
    ...database,
    async start() {
      await database.start();
      database.query(
        readFileSync(
          resolve(directory, 'customer_checkout_shipping_recovery_fixture.sql'),
          'utf8'
        )
      );
      database.query(
        definition(
          '20260915103400_uba_redvault_round34_review_fixes.sql',
          'public',
          'assert_shippable_order_payment'
        )
      );
      database.query(
        definition(
          '20260915102900_uba_redvault_round29_review_fixes.sql',
          'private',
          'uba_redvault_partial_refund_blocks_booking'
        )
      );
      database.query(
        definition(
          '20260905112000_include_internal_credit_in_settled_retention_gates.sql',
          'private',
          'order_settled_gigl_retained_amount'
        )
      );
      database.query(
        definition(
          '20260904153000_settled_retention_gates_self_fulfill_and_rebind.sql',
          'private',
          'stamp_gigl_order_economics'
        )
      );
      database.query(
        `CREATE TRIGGER stamp_gigl_order_economics BEFORE INSERT OR UPDATE OF selected_quote_id, shipping_funding_source, shipping_provider_cost, shipping_platform_margin, shipping_platform_retained_amount, shipping_pricing_version ON public.orders FOR EACH ROW EXECUTE FUNCTION private.stamp_gigl_order_economics();`
      );
      if (!beforeFix) {
        for (const name of readdirSync(migrations)
          .filter((name) =>
            name.includes('_customer_checkout_shipping_recovery_')
          )
          .sort()) {
          database.query(readFileSync(resolve(migrations, name), 'utf8'));
        }
      }
    },
  };
}
