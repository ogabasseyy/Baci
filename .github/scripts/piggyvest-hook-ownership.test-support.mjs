// Shared fixtures for the PiggyVest engine ownership check tests.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEngineOwnership } from './piggyvest-hook-ownership.mjs';

export const MANIFEST = `CREATE TEMP TABLE pv_engine_ownership (function_name text) ON COMMIT DROP;
INSERT INTO pv_engine_ownership (function_name, owner_task, rule) VALUES
  ('on_settled_collect', 'P5-engine-schema', 'dispatcher'),
  ('on_collect_confirmed_vtu', 'none', 'stub'),
  ('on_collect_confirmed_checkout', 'P6-checkout-collect-outcome', 'stub'),
  ('request_b_effect', 'P5-engine-schema', 'b_writer'),
  ('settle_attempt', 'P5-transfer-settle', 'define_once');
`;

export const stub = (name) =>
  `CREATE FUNCTION piggyvest_primary.${name}(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text $$;\n`;

export const DECLARATION = `-- piggyvest-engine-owner: P5-engine-schema
${stub('on_settled_collect')}${stub('on_collect_confirmed_vtu')}${stub('on_collect_confirmed_checkout')}
CREATE FUNCTION piggyvest_primary.request_b_effect(p uuid) RETURNS text LANGUAGE plpgsql AS $body$
BEGIN
  UPDATE public.customer_wallets SET available_balance = available_balance WHERE false;
  RETURN 'requested';
END $body$;
`;

function fixture(migrations, manifest = MANIFEST) {
  const root = mkdtempSync(join(tmpdir(), 'pv-hook-ownership-'));
  const migrationsDir = join(root, 'migrations');
  mkdirSync(migrationsDir);
  writeFileSync(join(root, 'manifest.inc.sql'), manifest);
  for (const [name, text] of Object.entries(migrations)) {
    writeFileSync(join(migrationsDir, name), text);
  }
  return {
    root,
    run: () =>
      checkEngineOwnership({
        migrationsDir,
        manifestPath: join(root, 'manifest.inc.sql'),
      }),
  };
}

export function withFixture(migrations, assertion, manifest) {
  const { root, run } = fixture(migrations, manifest);
  try {
    assertion(run());
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

export const declared = { '20261031221235_engine_hooks.sql': DECLARATION };
