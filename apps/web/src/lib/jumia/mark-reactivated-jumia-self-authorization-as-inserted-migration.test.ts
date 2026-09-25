import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../../..');

describe('mark reactivated Jumia self-authorization as inserted migration', () => {
  it('treats inactive-row reactivations as successful connects', () => {
    const migration = readFileSync(
      path.join(
        workspaceRoot,
        'supabase/migrations/20260822100000_mark_reactivated_jumia_self_authorization_as_inserted.sql'
      ),
      'utf8'
    );

    expect(migration).toMatch(
      /ON CONFLICT \(merchant_id, platform, shop_id, marketplace_key\) DO UPDATE SET[\s\S]*?is_active = true[\s\S]*?WHERE public\.marketplace_integrations\.is_active = false[\s\S]*?RETURNING id,[\s\S]*?true INTO v_integration_id, v_inserted;/i
    );
    expect(migration).not.toMatch(/RETURNING id,\s*\(xmax = 0\)/i);
  });
});
