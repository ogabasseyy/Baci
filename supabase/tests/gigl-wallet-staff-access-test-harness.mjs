import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShippingQuoteProofTestDatabase } from './shipping-quote-proof-postgres-test-harness.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = resolve(
  directory,
  '../migrations/20261031130000_allow_fulfil_staff_gigl_wallet_booking.sql'
);

// Applies the whole fulfil-staff migration (functions, policies and grants)
// to an isolated, network-less PostgreSQL with the real permission helpers.
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
      // behaviour is covered by the checkout-recovery PostgreSQL suites.
      database.query(
        `SET check_function_bodies = off;\n${readFileSync(migration, 'utf8')}`
      );
    },
  };
}
