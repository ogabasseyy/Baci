import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShippingQuoteProofTestDatabase } from './shipping-quote-proof-postgres-test-harness.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
// The fulfil-staff change ships as ordered migrations, one concern each.
const migrations = [
  '20261031130000_add_gigl_wallet_actor_columns.sql',
  '20261031130100_add_merchant_shipping_wallet_projections.sql',
  '20261031130200_allow_fulfil_staff_gigl_quote_bind.sql',
  '20261031130300_allow_fulfil_staff_wallet_reservation.sql',
  '20261031130400_allow_fulfil_staff_wallet_funding.sql',
  '20261031130500_allow_fulfil_staff_checkout_shipping_recovery.sql',
].map((name) => resolve(directory, '../migrations', name));

// Applies every fulfil-staff migration (columns, functions, policies and
// grants) in order to an isolated, network-less PostgreSQL with the real
// permission helpers.
export function createGiglWalletStaffAccessTestDatabase() {
  const database = createShippingQuoteProofTestDatabase();
  return {
    ...database,
    async start() {
      await database.start();
      database.query(
        readFileSync(
          resolve(directory, 'gigl_wallet_staff_access_fixture.sql'),
          'utf8'
        )
      );
      // Recovery bodies reference tables outside this wallet fixture; their
      // behaviour is covered by the checkout-recovery PostgreSQL suites. One
      // psql session keeps check_function_bodies off for every file.
      database.query(
        [
          'SET check_function_bodies = off;',
          ...migrations.map((path) => readFileSync(path, 'utf8')),
        ].join('\n')
      );
    },
  };
}
