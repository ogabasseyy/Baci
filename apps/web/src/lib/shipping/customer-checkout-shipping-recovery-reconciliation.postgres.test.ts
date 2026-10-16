import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';
import {
  RECOVERY_MERCHANT_ID,
  RECOVERY_ORDER_ID,
} from './customer-checkout-shipping-recovery.postgres.test-support';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const migrations = resolve(root, 'supabase/migrations');
const gate =
  '20261015215000_customer_checkout_shipping_recovery_activation_gate.sql';
const history = readdirSync(migrations)
  .filter(
    (name) =>
      name.includes('_customer_checkout_shipping_recovery_') && name !== gate
  )
  .sort();

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'legacy recovery reconciliation transaction',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase({
      beforeActivationGate: true,
    });
    let guard: string;
    beforeAll(async () => {
      await database.start();
      database.query(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text);
      INSERT INTO supabase_migrations.schema_migrations VALUES ${history.map((name) => `('${name.split('_')[0]}','${name.replace(/^\d+_|\.sql$/g, '')}')`).join(',')};`);
      const result = spawnSync(
        'bash',
        [
          '-e',
          '-c',
          `
      source .github/scripts/deferred-production-migrations.sh
      source .github/scripts/reconcile-checkout-recovery-legacy.sh
      migration_max_version=''; migrations_dir="$1"
      apply_pending_migration() { printf '%s' "$4"; }
      reconcile_checkout_recovery_legacy
    `,
          'test',
          migrations,
        ],
        { cwd: root, encoding: 'utf8' }
      );
      if (result.status !== 0) throw new Error(result.stderr);
      guard = result.stdout;
    }, 60000);
    afterAll(() => database.stop());

    it('installs the disabled gate and write backstop in a single transaction', () => {
      const output = database.query(`BEGIN; ${guard}
      ${readFileSync(resolve(migrations, gate), 'utf8')}
      SELECT enabled FROM private.checkout_shipping_recovery_release_activation;
      SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname='enforce_checkout_shipping_recovery_activation';
      ROLLBACK;`);
      expect(output.trim().split('\n').slice(-2)).toEqual(['f', '1']);
      expect(
        database
          .query(
            "SELECT to_regclass('private.checkout_shipping_recovery_release_activation') IS NULL;"
          )
          .trim()
      ).toBe('t');
    });
    it('rejects history changed since the client preflight', () => {
      expect(() =>
        database.query(`BEGIN;
      UPDATE supabase_migrations.schema_migrations SET name='changed' WHERE version='${history[0].split('_')[0]}';
      ${guard} COMMIT;`)
      ).toThrow('recovery_legacy_history_changed');
    });
    it('requires separate reconciliation if recovery writes have already appeared', () => {
      expect(() =>
        database.query(`BEGIN;
      INSERT INTO private.customer_checkout_shipping_recovery_previews
        (id,order_id,merchant_id,actor_id,fingerprint,original_address,quote,expires_at)
        SELECT '33333333-3333-4333-8333-333333333333','${RECOVERY_ORDER_ID}',id,user_id,
          repeat('a',64),'{}','{}',now()+interval '1 hour'
        FROM public.merchants WHERE id='${RECOVERY_MERCHANT_ID}';
      ${guard} COMMIT;`)
      ).toThrow('recovery_legacy_writes_require_reconciliation');
    });
    it('refuses a concurrently recorded or installed activation gate', () => {
      expect(() =>
        database.query(`BEGIN;
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20261015215000','customer_checkout_shipping_recovery_activation_gate');
      ${guard} COMMIT;`)
      ).toThrow('recovery_legacy_history_changed');
    });
  }
);
