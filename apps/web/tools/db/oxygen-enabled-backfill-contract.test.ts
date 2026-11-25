import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/20261125153000_add_oxygen_enabled_feature_setting.sql'
);

describe('20261125153000_add_oxygen_enabled_feature_setting backfill contract', () => {
  it('defaults oxygen_enabled to false and backfills only enabled production runtime bindings', async () => {
    const sql = await readFile(MIGRATION_PATH, 'utf8');

    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS oxygen_enabled boolean NOT NULL DEFAULT false;/
    );
    expect(sql).toMatch(
      /GRANT SELECT \(oxygen_enabled\) ON TABLE public\.merchant_feature_settings\s+TO authenticated;/
    );

    const backfillMatch = sql.match(
      /DO \$oxygen_backfill\$([\s\S]*?)END\s+\$oxygen_backfill\$;/
    );
    expect(backfillMatch).not.toBeNull();
    const backfillBody = backfillMatch?.[1] ?? '';

    expect(backfillBody).toMatch(
      /INSERT INTO public\.merchant_feature_settings \(merchant_id, oxygen_enabled\)/
    );
    expect(backfillBody).toMatch(/FROM oxygen_private\.runtime_bindings AS b/);
    expect(backfillBody).toMatch(/WHERE b\.enabled IS TRUE/);
    expect(backfillBody).toMatch(/AND b\.environment = 'production'/);
    expect(backfillBody).toMatch(
      /ON CONFLICT \(merchant_id\) DO UPDATE\s+SET oxygen_enabled = true/
    );
  });

  it('enforces oxygen_enabled in pilot availability and FOR SHARE workflow entrypoint', async () => {
    const sql = await readFile(MIGRATION_PATH, 'utf8');

    expect(sql).toMatch(/AND s\.oxygen_enabled IS TRUE/);
    expect(sql).toMatch(
      /FROM public\.merchant_feature_settings AS s\s+WHERE s\.merchant_id = v_merchant_id\s+AND s\.oxygen_enabled IS TRUE\s+FOR SHARE;/
    );
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE = '42501';/
    );
  });
});
