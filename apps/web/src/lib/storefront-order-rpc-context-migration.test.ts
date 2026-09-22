import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828091000_harden_storefront_order_rpc_context_and_replays.sql'
  ),
  'utf8'
);
const hashPreparationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828110000_prepare_storefront_order_hash_stamping.sql'
  ),
  'utf8'
);
const rolloutSafeHashPreparationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828170000_prepare_storefront_order_hash_version_context.sql'
  ),
  'utf8'
);
const hashFinalizerMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828110100_finalize_storefront_order_hash_stamping.sql'
  ),
  'utf8'
);
const quizReservedDeliveryMetadataPreservationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828160100_preserve_quiz_reserved_order_delivery_metadata.sql'
  ),
  'utf8'
);
const deliveryMetadataPersistencePreparationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828151100_prepare_storefront_order_delivery_metadata_persistence.sql'
  ),
  'utf8'
);
const deliveryMetadataEnforcementRestoreMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828190000_restore_storefront_order_delivery_metadata_enforcement.sql'
  ),
  'utf8'
);
const deferredMigrationPolicy = readFileSync(
  resolve(
    process.cwd(),
    '../../.github/scripts/deferred-production-migrations.sh'
  ),
  'utf8'
);
const deployWorkflow = readFileSync(
  resolve(process.cwd(), '../../.github/workflows/deploy.yml'),
  'utf8'
);
const postdeployAction = readFileSync(
  resolve(
    process.cwd(),
    '../../.github/actions/postdeploy-migrations/action.yml'
  ),
  'utf8'
);
const postdeployMigrationPolicy = deferredMigrationPolicy.slice(
  0,
  deferredMigrationPolicy.indexOf('# These migrations replace')
);
describe('storefront order RPC context migration contract', () => {
  it('requires a signed merchant-bound route context for non-internal inserts', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.enforce_storefront_order_route_context()'
    );
    expect(migration).toContain("'storefront_order_context'");
    expect(migration).toContain("'storefront_order_merchant_id'");
    expect(migration).toContain("'agentic_context'");
    expect(migration).toContain("'storefront_order_route_context_required'");
    expect(migration).toContain('BEFORE INSERT ON public.orders');
  });

  it('preserves only the signed customer-owned legacy quiz award path', () => {
    expect(migration).toContain("'quiz_award_context'");
    expect(migration).toContain("'legacy-answer'");
    expect(migration).toContain("NEW.payment_method = 'quiz_award'");
    expect(migration).toContain("NEW.source = 'quiz_prize'");
    expect(migration).toContain('c.user_id = (SELECT auth.uid())');
    expect(migration).toContain('c.merchant_id = NEW.merchant_id');

    const quizMigration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260828101000_allow_legacy_quiz_award_order_context.sql'
      ),
      'utf8'
    );

    expect(quizMigration).toContain("'quiz_award_context'");
    expect(quizMigration).toContain("'legacy-answer'");
    expect(quizMigration).toContain("NEW.payment_method = 'quiz_award'");
    expect(quizMigration).toContain("NEW.source = 'quiz_prize'");
    expect(quizMigration).toContain('c.user_id = (SELECT auth.uid())');
    expect(quizMigration).toContain('c.merchant_id = NEW.merchant_id');
  });

  it('marks new orders and exposes only a legacy-version boolean probe', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS checkout_request_hash_version smallint'
    );
    expect(migration).toContain('NEW.checkout_request_hash_version := 2');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_legacy_storefront_order_idempotency_key('
    );
    expect(migration).toContain('o.checkout_request_hash_version IS NULL');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).toContain('TO anon, authenticated');
  });

  it('defers enforcement while delivery metadata persistence is predeploy', () => {
    expect(hashPreparationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS checkout_request_hash_version smallint'
    );
    expect(hashPreparationMigration).toContain(
      'NEW.checkout_request_hash_version := 2'
    );
    expect(hashPreparationMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_legacy_storefront_order_idempotency_key('
    );
    expect(postdeployMigrationPolicy).toContain(
      '20260827140000_enforce_storefront_order_delivery_metadata'
    );
    expect(postdeployMigrationPolicy).toContain(
      '20260828110000_prepare_storefront_order_hash_stamping'
    );
    expect(postdeployMigrationPolicy).toContain(
      '20260828110100_finalize_storefront_order_hash_stamping'
    );
    expect(postdeployMigrationPolicy).toContain(
      '20260828151000_enforce_storefront_airport_pickup_location'
    );
    expect(postdeployMigrationPolicy).not.toContain(
      '20260828160000_persist_quiz_reserved_order_delivery_metadata'
    );
    expect(postdeployMigrationPolicy).not.toContain(
      '20260828160100_preserve_quiz_reserved_order_delivery_metadata'
    );
    expect(postdeployMigrationPolicy).not.toContain(
      '20260828151100_prepare_storefront_order_delivery_metadata_persistence'
    );
  });

  it('drains the previous route revision before postdeploy enforcement', () => {
    const preflightStep = postdeployAction.indexOf(
      '- name: Check for pending deferred storefront migrations'
    );
    const drainStep = postdeployAction.indexOf(
      '- name: Drain previous storefront order requests'
    );
    const migrationStep = postdeployAction.indexOf(
      '- name: Apply migrations deferred until application deploy'
    );

    expect(preflightStep).toBeGreaterThanOrEqual(0);
    expect(drainStep).toBeGreaterThanOrEqual(0);
    expect(preflightStep).toBeLessThan(drainStep);
    expect(postdeployAction).toContain(
      '.github/scripts/pending-postdeploy-migrations.sh'
    );
    expect(postdeployAction).toContain(
      "if: steps.pending-deferred-migrations.outputs.pending == 'true'"
    );
    expect(postdeployAction).toContain('run: sleep 305');
    expect(postdeployAction).toContain('300-second default window');
    expect(deployWorkflow).toContain(
      'uses: ./.github/actions/postdeploy-migrations'
    );
    expect(migrationStep).toBeGreaterThan(drainStep);
  });

  it('stamps only signed v2 storefront hashes before promotion', () => {
    expect(rolloutSafeHashPreparationMigration).toContain(
      'NEW.checkout_request_hash_version := NULL'
    );
    expect(rolloutSafeHashPreparationMigration).toContain(
      'NEW.checkout_request_hash IS NOT NULL'
    );
    expect(rolloutSafeHashPreparationMigration).toContain(
      "'storefront_order_hash_version', '') = '2'"
    );
    expect(rolloutSafeHashPreparationMigration).toContain(
      "'storefront_order_context', '') = 'route'"
    );
    expect(rolloutSafeHashPreparationMigration).toContain(
      "'storefront_order_merchant_id', '')"
    );
    expect(hashFinalizerMigration).toContain(
      'NEW.checkout_request_hash_version := NULL'
    );
    expect(hashFinalizerMigration).toContain(
      "'storefront_order_hash_version', '') = '2'"
    );
  });

  it('preserves redeemed quiz delivery metadata on later fulfillment updates', () => {
    expect(quizReservedDeliveryMetadataPreservationMigration).toContain(
      "NEW.ad_tracking ? '__baci_delivery_method'"
    );
    expect(quizReservedDeliveryMetadataPreservationMigration).toContain(
      "NEW.ad_tracking ? '__baci_airport_type'"
    );
    expect(quizReservedDeliveryMetadataPreservationMigration).toContain(
      'NEW.delivery_method := NULL'
    );
  });

  it('persists signed route delivery metadata before deferred enforcement', () => {
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      'CREATE OR REPLACE FUNCTION private.validate_storefront_order_delivery_metadata()'
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      "'storefront_order_context', '') = 'route'"
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      'IF NOT v_route_context'
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      "pg_catalog.jsonb_typeof(NEW.ad_tracking) <> 'object'"
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      "'storefront_order_merchant_id', '')"
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      "NEW.ad_tracking ->> '__baci_delivery_method'"
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      'BEFORE INSERT ON public.orders'
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      'private.validate_storefront_airport_pickup_location()'
    );
    expect(deliveryMetadataPersistencePreparationMigration).toContain(
      "NEW.ad_tracking := NEW.ad_tracking\n    - '__baci_delivery_method'"
    );
    expect(postdeployMigrationPolicy).not.toContain(
      '20260828151100_prepare_storefront_order_delivery_metadata_persistence'
    );
  });

  it('restores full delivery enforcement after chronological compatibility replay', () => {
    expect(deliveryMetadataEnforcementRestoreMigration).toContain(
      'CREATE OR REPLACE FUNCTION private.validate_storefront_order_delivery_metadata()'
    );
    expect(deliveryMetadataEnforcementRestoreMigration).toContain(
      'Selected airport delivery quote is invalid or expired'
    );
    expect(deliveryMetadataEnforcementRestoreMigration).toContain(
      "WHEN 'delivery' THEN 35000::numeric"
    );
    expect(deliveryMetadataEnforcementRestoreMigration).toContain(
      'BEFORE INSERT ON public.orders'
    );
    expect(postdeployMigrationPolicy).toContain(
      '20260828190000_restore_storefront_order_delivery_metadata_enforcement'
    );
  });

  it('exposes a boolean probe for a stored checkout request hash', () => {
    const probeMigration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260911200000_probe_storefront_order_idempotency_hash.sql'
      ),
      'utf8'
    );

    expect(probeMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_storefront_order_idempotency_hash('
    );
    expect(probeMigration).toContain('o.checkout_request_hash = trim(');
    expect(probeMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.is_storefront_order_idempotency_hash(uuid, text, text)'
    );
    expect(probeMigration).toContain('TO anon, authenticated');
    expect(probeMigration).not.toContain('SELECT o.id');
  });
});
