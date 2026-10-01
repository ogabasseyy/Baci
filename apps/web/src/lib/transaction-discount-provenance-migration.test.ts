import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828020000_authenticate_transaction_discount_metadata.sql'
  ),
  'utf8'
);
const hardenedMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828030000_harden_transaction_discount_admin_context.sql'
  ),
  'utf8'
);
const payloadBindingMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828040000_bind_transaction_discount_proof_payload.sql'
  ),
  'utf8'
);
const replayBindingMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828050000_bind_transaction_discount_proof_replay.sql'
  ),
  'utf8'
);
const replaySignatureBindingMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828060000_bind_transaction_discount_replay_signature.sql'
  ),
  'utf8'
);
const historicalBackfillMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828070000_backfill_historical_admin_discount_provenance.sql'
  ),
  'utf8'
);
const proofRejectionMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828200000_reject_unverified_transaction_discount_proofs.sql'
  ),
  'utf8'
);
const proofReplayAfterExpiryMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830100000_accept_bound_transaction_discount_replays_after_expiry.sql'
  ),
  'utf8'
);
const scopedQuizAwardSnapshotMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830120000_scope_quiz_award_snapshot_to_merchant.sql'
  ),
  'utf8'
);
const replayCleanupMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830130000_remove_transaction_discount_replay_row_cleanup.sql'
  ),
  'utf8'
);
const replayPayloadBindingMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830160000_bind_transaction_discount_replay_payload.sql'
  ),
  'utf8'
);
const scopedQuizAwardRepairMigrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830140000_repair_quiz_award_snapshot_scope.sql'
  ),
  'utf8'
);

describe('transaction discount provenance migration', () => {
  it('accepts only proof-bound storefront metadata and strips forged markers', () => {
    expect(migrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.sanitize_storefront_transaction_discount_metadata\(\)/i
    );
    expect(migrationSql).toMatch(
      /v_proof -> 'payload' = \(v_metadata - 'proof'\)/i
    );
    expect(migrationSql).toMatch(
      /quiz_route_proof_valid\([\s\S]*?'storefront_transaction_discount'/i
    );
    expect(migrationSql).toContain("v_tracking - 'baci_transaction_discount'");
    expect(migrationSql).toMatch(
      /CREATE TRIGGER sanitize_storefront_transaction_discount_metadata[\s\S]*?ON public\.orders/i
    );
  });

  it('scopes admin provenance to the authenticated edit wrapper context', () => {
    expect(migrationSql).toMatch(
      /current_setting\('app\.transaction_discount_admin_edit', true\) = '1'/i
    );
    expect(migrationSql).toMatch(
      /set_config\([\s\S]*?'app\.transaction_discount_admin_edit'[\s\S]*?'1'/i
    );
    expect(migrationSql).toContain(
      "jsonb_build_object('status', 'admin_edit', 'version', 4)"
    );
  });

  it('uses a private transaction context instead of a caller-controlled GUC', () => {
    expect(hardenedMigrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS private\.transaction_discount_admin_edit_context/i
    );
    expect(hardenedMigrationSql).toMatch(
      /context\.transaction_id = pg_catalog\.txid_current\(\)/i
    );
    expect(hardenedMigrationSql).toMatch(
      /INSERT INTO private\.transaction_discount_admin_edit_context/i
    );
    expect(hardenedMigrationSql).not.toContain(
      'app.transaction_discount_admin_edit'
    );
  });

  it('recomputes the signed payload hash before accepting storefront metadata', () => {
    expect(payloadBindingMigrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.canonical_jsonb\(p_value jsonb\)/i
    );
    expect(payloadBindingMigrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.transaction_discount_payload_hash\(p_payload jsonb\)/i
    );
    expect(payloadBindingMigrationSql).toMatch(
      /v_proof ->> 'payload_hash'\s*=\s*private\.transaction_discount_payload_hash\(v_proof -> 'payload'\)/i
    );
  });

  it('consumes each storefront transaction discount proof only once', () => {
    expect(replayBindingMigrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS private\.transaction_discount_proof_replay/i
    );
    expect(replayBindingMigrationSql).toMatch(
      /ON CONFLICT \(proof_id\) DO NOTHING/i
    );
    expect(replayBindingMigrationSql).toMatch(
      /GET DIAGNOSTICS v_inserted_count = ROW_COUNT/i
    );
  });

  it('keys replay consumption by the signed proof instead of proof_id', () => {
    expect(replaySignatureBindingMigrationSql).toMatch(
      /v_proof ->> 'proof_id'\s*=\s*pg_catalog\.left\(v_proof ->> 'signature',\s*24\)/i
    );
    expect(replaySignatureBindingMigrationSql).toMatch(
      /INSERT INTO private\.transaction_discount_proof_replay\s*\(\s*proof_id,\s*order_id,\s*merchant_id\s*\)\s*VALUES\s*\(\s*v_proof ->> 'signature',\s*NEW\.id,\s*NEW\.merchant_id\s*\)/i
    );
  });

  it('keeps the historical backfill temp rows alive until the migration commits', () => {
    expect(historicalBackfillMigrationSql).toMatch(/\nBEGIN;\s/i);
    expect(historicalBackfillMigrationSql).toMatch(
      /CREATE TEMP TABLE historical_admin_discount_edits[\s\S]*?ON COMMIT DROP;/i
    );
    expect(historicalBackfillMigrationSql).toMatch(/\nCOMMIT;\s*$/i);
  });

  it('fails closed when a version-three proof cannot be accepted', () => {
    expect(proofRejectionMigrationSql).toMatch(
      /v_metadata ->> 'version' = '3'[\s\S]*?v_metadata \? 'proof'[\s\S]*?RAISE EXCEPTION 'transaction_discount_proof_rejected'/i
    );
    expect(proofRejectionMigrationSql).toMatch(
      /ON CONFLICT \(proof_id\) DO NOTHING[\s\S]*?GET DIAGNOSTICS v_inserted_count = ROW_COUNT/i
    );
    expect(proofRejectionMigrationSql).toMatch(
      /replay\.order_id = NEW\.id[\s\S]*?replay\.merchant_id = NEW\.merchant_id/i
    );
  });

  it('accepts only an unchanged same-order replay before checking proof expiry', () => {
    const sameOrderReplayIndex = proofReplayAfterExpiryMigrationSql.indexOf(
      "replay.proof_id = v_proof ->> 'signature'"
    );
    const proofValidationIndex = proofReplayAfterExpiryMigrationSql.indexOf(
      'IF public.quiz_route_proof_valid('
    );

    expect(proofReplayAfterExpiryMigrationSql).toMatch(
      /v_proof ->> 'proof_id' = pg_catalog\.left\(v_proof ->> 'signature', 24\)/i
    );
    expect(proofReplayAfterExpiryMigrationSql).toMatch(
      /v_proof -> 'payload' = \(v_metadata - 'proof'\)/i
    );
    expect(sameOrderReplayIndex).toBeGreaterThan(-1);
    expect(proofValidationIndex).toBeGreaterThan(-1);
    expect(sameOrderReplayIndex).toBeLessThan(proofValidationIndex);
  });

  it('keeps replay cleanup bounded and indexed by consumption time', () => {
    expect(replayBindingMigrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS transaction_discount_proof_replay_consumed_at_idx[\s\S]*?\(consumed_at\)/i
    );
    expect(proofRejectionMigrationSql).toMatch(
      /DELETE FROM private\.transaction_discount_proof_replay[\s\S]*?consumed_at < pg_catalog\.now\(\) - INTERVAL '1 day'/i
    );
    expect(proofReplayAfterExpiryMigrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS transaction_discount_proof_replay_order_id_idx[\s\S]*?\(order_id\)/i
    );
    expect(proofReplayAfterExpiryMigrationSql).toMatch(
      /DELETE FROM private\.transaction_discount_proof_replay AS replay[\s\S]*?AND NOT EXISTS \([\s\S]*?FROM public\.orders AS order_row[\s\S]*?order_row\.id = replay\.order_id/i
    );
  });

  it('scopes quiz award snapshots to the order merchant', () => {
    expect(scopedQuizAwardSnapshotMigrationSql).toMatch(
      /JOIN public\.quiz_events AS event_row[\s\S]*?JOIN public\.orders AS order_row[\s\S]*?event_row\.merchant_id = order_row\.merchant_id/i
    );
    expect(scopedQuizAwardSnapshotMigrationSql).toMatch(
      /NEW\.quiz_award_amount := NULL;[\s\S]*?SELECT qa\.amount[\s\S]*?WHERE qa\.id = NEW\.quiz_award_id/i
    );
  });

  it('clears cross-merchant award ids instead of leaving voucher markers', () => {
    expect(scopedQuizAwardRepairMigrationSql).toMatch(
      /IF NOT FOUND THEN[\s\S]*?NEW\.quiz_award_id := NULL;[\s\S]*?NEW\.quiz_award_amount := NULL;/i
    );
    expect(scopedQuizAwardRepairMigrationSql).toMatch(
      /SET quiz_award_id = NULL,[\s\S]*?quiz_award_amount = NULL/i
    );
  });

  it('cleans replay bindings on order deletion instead of in the row trigger', () => {
    const sanitizerStart = replayCleanupMigrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION private.sanitize_storefront_transaction_discount_metadata()'
    );
    const sanitizerEnd = replayCleanupMigrationSql.indexOf(
      'ALTER FUNCTION private.sanitize_storefront_transaction_discount_metadata()',
      sanitizerStart
    );
    const sanitizerSql = replayCleanupMigrationSql.slice(
      sanitizerStart,
      sanitizerEnd
    );

    expect(sanitizerSql).not.toMatch(
      /DELETE FROM private\.transaction_discount_proof_replay/i
    );
    expect(replayCleanupMigrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION private\.cleanup_transaction_discount_proof_replay_after_order_delete\(\)[\s\S]*?DELETE FROM private\.transaction_discount_proof_replay[\s\S]*?replay\.order_id = OLD\.id/i
    );
    expect(replayCleanupMigrationSql).toMatch(
      /CREATE TRIGGER cleanup_transaction_discount_proof_replay_after_order_delete[\s\S]*?AFTER DELETE ON public\.orders/i
    );
  });

  it('binds same-order replay acceptance to the authenticated payload hash', () => {
    expect(replayPayloadBindingMigrationSql).toMatch(
      /ADD COLUMN IF NOT EXISTS payload_hash text/i
    );
    expect(replayPayloadBindingMigrationSql).toMatch(
      /replay\.payload_hash = v_payload_hash/i
    );
    expect(replayPayloadBindingMigrationSql).toMatch(
      /INSERT INTO private\.transaction_discount_proof_replay(?: AS replay)?\s*\([\s\S]*?payload_hash[\s\S]*?v_payload_hash/i
    );
  });

  it('preserves only unchanged legacy version-two markers', () => {
    expect(replayPayloadBindingMigrationSql).toMatch(
      /TG_OP = 'UPDATE'[\s\S]*?v_metadata ->> 'version' = '2'[\s\S]*?OLD\.ad_tracking -> 'baci_transaction_discount' = v_metadata/i
    );
  });
});
