import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const database = `baci_redvault_public_test_${process.pid}`;
const port = process.env.REDVAULT_LOCAL_TEST_PORT ?? '55439';
if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error('invalid local test PostgreSQL port');
}
const psql = (target, sql) => execFileSync('psql', [
  '-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres',target,
], { input: sql, encoding: 'utf8', stdio: ['pipe','pipe','inherit'] });

psql('postgres', `CREATE DATABASE ${database};`);
try {
  const source = path => readFileSync(`${root}${path}`, 'utf8');
  const scripts = [
    source('tests/redvault-public-product-test-fixture.sql'),
    source('20260928120000_uba_redvault_private_pilot_policy.sql'),
    'ALTER TABLE private.uba_redvault_live_pilot_policy ADD COLUMN staging_test_mode boolean NOT NULL DEFAULT false;',
    source('20261006190100_uba_redvault_pilot_preserved_binding_shipment_savings.sql'),
    'CREATE TRIGGER pilot_shipment BEFORE INSERT OR UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION private.guard_uba_redvault_pilot_shipment_write();',
    source('20261018110000_uba_redvault_public_product_test_policy.sql'),
    source('20261018110100_uba_redvault_public_product_test_guards.sql'),
    source('20261018110200_uba_redvault_public_product_test_projection.sql'),
    source('tests/redvault-public-product-test-cases.sql'),
  ];
  psql(database, scripts.join('\n'));
  process.stdout.write('Public REDVAULT product PostgreSQL regression passed; no provider requests.\n');
} finally {
  psql('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
}
