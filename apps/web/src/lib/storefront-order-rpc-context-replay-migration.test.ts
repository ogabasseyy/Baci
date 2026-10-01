import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const replayContextMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828120000_enforce_storefront_order_replay_route_context.sql'
  ),
  'utf8'
);
const replayScopeMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828130000_scope_storefront_order_replay_route_context.sql'
  ),
  'utf8'
);
const replayMetadataPersistenceMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828180000_persist_storefront_order_delivery_metadata_replay.sql'
  ),
  'utf8'
);

describe('storefront order RPC replay migration contract', () => {
  it('guards idempotent replay updates with the same route context', () => {
    expect(replayContextMigration).toContain('BEFORE UPDATE ON public.orders');
    expect(replayContextMigration).toContain(
      'OLD.checkout_idempotency_key IS NOT NULL'
    );
    expect(replayContextMigration).toContain("NEW.shipping_status = 'pending'");
    expect(replayContextMigration).toContain(
      'private.enforce_storefront_order_route_context()'
    );
  });

  it('scopes the update trigger to the guarded create replay delegate', () => {
    expect(replayScopeMigration).toContain(
      'RENAME TO create_storefront_order_unchecked'
    );
    expect(replayScopeMigration).toContain(
      "'baci.storefront_order_replay_context'"
    );
    expect(replayScopeMigration).toContain(
      "'create_storefront_order',\n    true"
    );
    expect(replayScopeMigration).toContain(
      'REVOKE ALL ON FUNCTION private.create_storefront_order_unchecked'
    );
    expect(replayScopeMigration).toContain(
      "current_setting('baci.storefront_order_replay_context', true)"
    );
    expect(replayScopeMigration).toContain(
      'NEW.checkout_idempotency_key IS NOT DISTINCT FROM OLD.checkout_idempotency_key'
    );
  });

  it('keeps legacy replay metadata repair route-scoped and discriminator-bound', () => {
    expect(replayMetadataPersistenceMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.persist_storefront_order_delivery_metadata('
    );
    expect(replayMetadataPersistenceMigration).toContain(
      "'storefront_order_context', '') <> 'route'"
    );
    expect(replayMetadataPersistenceMigration).toContain(
      "'storefront_order_merchant_id'"
    );
    expect(replayMetadataPersistenceMigration).toContain(
      'v_order.checkout_idempotency_key IS NULL'
    );
    expect(replayMetadataPersistenceMigration).toContain(
      "v_marker IN ('airport delivery', 'airport delivery (outside lagos)')"
    );
    expect(replayMetadataPersistenceMigration).toContain(
      "v_marker = 'airport pickup'"
    );
    expect(replayMetadataPersistenceMigration).toContain(
      "v_quote_rate_id, '_', 6) = '1'"
    );
    expect(replayMetadataPersistenceMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.persist_storefront_order_delivery_metadata'
    );
    expect(replayMetadataPersistenceMigration).not.toContain(
      'shipping_fee = 25000'
    );
  });
});
