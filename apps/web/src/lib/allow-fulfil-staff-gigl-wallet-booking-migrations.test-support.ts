import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MIGRATIONS_DIRECTORY = resolve(
  process.cwd(),
  '../../supabase/migrations'
);

interface FulfilStaffMigration {
  name: string;
  /** Functions this migration (re)defines, each with its own REVOKE/GRANT. */
  functions: readonly string[];
}

/** The fulfil-staff GIG wallet access change, in apply order. */
export const FULFIL_STAFF_GIGL_MIGRATIONS: readonly FulfilStaffMigration[] = [
  { name: '20261031130000_add_gigl_wallet_actor_columns.sql', functions: [] },
  {
    name: '20261031130100_add_merchant_shipping_wallet_projections.sql',
    functions: [
      'public.get_merchant_shipping_wallet_balance',
      'public.get_merchant_wallet_funding_account',
    ],
  },
  {
    name: '20261031130200_allow_fulfil_staff_gigl_quote_bind.sql',
    functions: ['public.bind_admin_gigl_quote'],
  },
  {
    name: '20261031130300_allow_fulfil_staff_wallet_reservation.sql',
    functions: ['public.reserve_merchant_shipping_charge'],
  },
  {
    name: '20261031130400_allow_fulfil_staff_wallet_funding.sql',
    functions: [
      'public.fail_merchant_wallet_funding_request',
      'public.complete_merchant_wallet_funding_recovery',
    ],
  },
  {
    name: '20261031130500_allow_fulfil_staff_checkout_shipping_recovery.sql',
    functions: [
      'private.assert_customer_checkout_shipping_recovery',
      'public.confirm_customer_checkout_shipping_recovery',
    ],
  },
];

export const readMigration = (name: string): string =>
  readFileSync(resolve(MIGRATIONS_DIRECTORY, name), 'utf8');

/** Every fulfil-staff migration concatenated in apply order. */
export const readFulfilStaffMigrationSeries = (): string =>
  FULFIL_STAFF_GIGL_MIGRATIONS.map(({ name }) => readMigration(name)).join('');
