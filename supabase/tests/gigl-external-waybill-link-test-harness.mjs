import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShippingQuoteProofTestDatabase } from './shipping-quote-proof-postgres-test-harness.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '../migrations');

function readMigration(name) {
  return readFileSync(resolve(migrations, name), 'utf8');
}

// The production BEFORE INSERT economics trigger, extracted unchanged, so the
// migration under test must preserve it while admitting external rows.
function productionEconomicsTrigger() {
  const source = readMigration(
    '20260903135000_attest_shipping_quote_writes_and_shipment_grants.sql'
  );
  const start = source.indexOf(
    'CREATE OR REPLACE FUNCTION private.stamp_gigl_shipment_economics()'
  );
  const end = source.indexOf(
    'EXECUTE FUNCTION private.stamp_gigl_shipment_economics();',
    start
  );
  if (start < 0 || end < 0) throw new Error('Missing economics trigger');
  return source.slice(
    start,
    end + 'EXECUTE FUNCTION private.stamp_gigl_shipment_economics();'.length
  );
}

export function createGiglExternalWaybillLinkTestDatabase() {
  const database = createShippingQuoteProofTestDatabase();
  return {
    ...database,
    async start() {
      await database.start();
      database.query(
        readFileSync(
          resolve(directory, 'gigl_external_waybill_link_fixture.sql'),
          'utf8'
        )
      );
      database.query(productionEconomicsTrigger());
      database.query(
        readMigration('20261102130000_link_external_gigl_waybill.sql')
      );
    },
  };
}
