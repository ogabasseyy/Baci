import { describe, expect, it } from 'vitest';
import { EXPECTED_QUIZ_LIVE_PENDING_SOURCES } from './expected-quiz-live-pending-sources.test-support';
import { REPLAY_SOURCE_DATA } from './supabase-history-replay-sources';

const {
  PIPELINE_SOURCES,
  POST_REPLAY_SOURCES,
  PENDING_SOURCES,
  PRODUCTION_MAPPINGS,
} = REPLAY_SOURCE_DATA;

/**
 * Colocated guard for the extracted replay-source data. The manifest module
 * (`supabase-history-replay-manifest.ts`) parses these template-literal blocks
 * with `parseFrozenSources` / `parseProductionMappings`, both of which throw on a
 * malformed row. This test fails fast — with a readable message — if an edit to
 * this data breaks the row shape, rather than surfacing as an opaque parser throw
 * inside the far slower manifest-verification suite.
 */

const FROZEN_ROW = /^[0-9a-f]{64} 202\d{11}_[a-z0-9_]+\.sql$/;
const MAPPING_ROW =
  /^202\d{11}\t202\d{11}_[a-z0-9_]+\.sql\t[0-9a-f]{64}\t[a-z-]+$/;
const ADDITIVE_PROVENANCE_MIGRATION =
  '20260731090000_add_product_description_provenance.sql';
const CORRECTIVE_ATTESTATION_MIGRATION =
  '20260731100000_harden_product_description_attestation_grants.sql';
const RETENTION_PROVENANCE_MIGRATION =
  '20260801090000_harden_product_description_provenance_retention.sql';
const OPERATION_ID_BINDING_MIGRATION =
  '20260801100000_preserve_product_description_attestation_operation_ids.sql';
const ATTESTATION_PRIVACY_MIGRATION =
  '20260801110000_harden_product_description_attestation_privacy.sql';
const ATTESTATION_ISSUANCE_MIGRATION =
  '20260801130000_bound_product_description_attestation_issuance.sql';
const OPERATION_ID_SCOPE_MIGRATION =
  '20260801160000_scope_product_description_attestation_operation_ids.sql';
const ATTESTATION_GRANT_FUNCTION_MIGRATION =
  '20260801170000_redefine_product_description_attestation_grant.sql';
const ATTESTATION_INDEX_MIGRATION =
  '20260801180000_harden_product_description_attestation_indexes.sql';
const ATTESTATION_INDEX_RECOVERY_MIGRATION =
  '20260801190000_recover_product_description_attestation_indexes.sql';
const ATTESTATION_PERMISSION_MIGRATION =
  '20260801210000_require_product_permission_for_attestation_grant.sql';

function rows(block: string): string[] {
  return block
    .trim()
    .split('\n')
    .filter((row) => row.length > 0);
}

describe('supabase-history-replay sources', () => {
  it.each([
    ['PIPELINE_SOURCES', PIPELINE_SOURCES],
    ['POST_REPLAY_SOURCES', POST_REPLAY_SOURCES],
    ['PENDING_SOURCES', PENDING_SOURCES],
  ])('%s rows are all `<sha256> <filename>.sql`', (_name, block) => {
    for (const row of rows(block)) {
      expect(row, `malformed frozen source row: ${row}`).toMatch(FROZEN_ROW);
    }
  });

  it('PRODUCTION_MAPPINGS rows are `<version>\\t<file>\\t<sha256>\\t<rule>`', () => {
    for (const row of rows(PRODUCTION_MAPPINGS)) {
      expect(row, `malformed production mapping row: ${row}`).toMatch(
        MAPPING_ROW
      );
    }
  });

  it('contains no blank rows (a blank row would throw in parseFrozenSources)', () => {
    for (const [name, block] of [
      ['PIPELINE_SOURCES', PIPELINE_SOURCES],
      ['POST_REPLAY_SOURCES', POST_REPLAY_SOURCES],
      ['PENDING_SOURCES', PENDING_SOURCES],
      ['PRODUCTION_MAPPINGS', PRODUCTION_MAPPINGS],
    ] as const) {
      const hasInternalBlank = block
        .trim()
        .split('\n')
        .some((row) => row.trim().length === 0);
      expect(hasInternalBlank, `${name} has a blank row`).toBe(false);
    }
  });

  it('registers the provenance migrations in execution order', () => {
    const migrationOrder = [
      ADDITIVE_PROVENANCE_MIGRATION,
      CORRECTIVE_ATTESTATION_MIGRATION,
      RETENTION_PROVENANCE_MIGRATION,
      OPERATION_ID_BINDING_MIGRATION,
      ATTESTATION_PRIVACY_MIGRATION,
      ATTESTATION_ISSUANCE_MIGRATION,
      OPERATION_ID_SCOPE_MIGRATION,
      ATTESTATION_GRANT_FUNCTION_MIGRATION,
      ATTESTATION_INDEX_MIGRATION,
      ATTESTATION_INDEX_RECOVERY_MIGRATION,
      ATTESTATION_PERMISSION_MIGRATION,
    ].map((migration) => PENDING_SOURCES.indexOf(migration));
    expect(migrationOrder.every((index) => index >= 0)).toBe(true);
    expect(migrationOrder).toEqual([...migrationOrder].sort((a, b) => a - b));
  });

  it('registers each source filename at most once across all blocks', () => {
    const names = [
      ...rows(PIPELINE_SOURCES),
      ...rows(POST_REPLAY_SOURCES),
      ...rows(PENDING_SOURCES),
    ].map((row) => row.split(' ')[1]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('orders pending sources by migration filename across independently maintained batches', () => {
    const pendingRows = rows(PENDING_SOURCES);
    const pendingFilenames = pendingRows.map((row) => row.split(' ')[1] ?? '');

    expect(pendingFilenames).toEqual([...pendingFilenames].sort());
    expect(
      pendingFilenames.indexOf('20260805150000_platform_admin_rbac.sql')
    ).toBeLessThan(
      pendingFilenames.indexOf(
        '20260805173000_harden_merchant_invoice_partial_completion.sql'
      )
    );
  });

  it('registers the bounded identity-verification capability as a pending source', () => {
    expect(rows(PENDING_SOURCES)).toContain(
      '60be0be8990407b279108981c8c47815a90f8855a05a106d6a9024e23cb6998d 20260729100000_add_merchant_identity_verified_rpc.sql'
    );
  });

  it('registers the Jumia authorization repair migrations in the replay input', () => {
    expect(rows(PENDING_SOURCES)).toEqual(
      expect.arrayContaining([
        'e4b0d916cd49b542c2e7a4f3060b756bcebc7e9b5332a230277afa667fcb25a8 20260822100000_mark_reactivated_jumia_self_authorization_as_inserted.sql',
        'b083e3e5682da5828f34d9593304d2371a1b38abb8020701e22e6ec1e1350f67 20260823100000_jumia_orphan_authorization_sweep.sql',
        '3afab9495b805517ee42d7492a9666a608ffba11172321a3a810a0cb1c597780 20260823110000_harden_jumia_orphan_authorization_sweep.sql',
        '629f967ffa25a8f79c38387262007e184e6ccb99d9bf0ef40cf5e43940ca00fa 20260824230000_allow_jumia_view_credential_refresh.sql',
        '1cb9abb1ef1bd5b9026c44958c78ee8534be0fbc065076112d6f979ead65921e 20260824230100_lock_each_jumia_orphan_shop.sql',
        'af3fa5a276348e8ec9ead71449beb1704a71a61adf6bd13e7a66542d5c2bfac2 20260825000001_restore_jumia_manage_credential_rotation.sql',
        'f051891d4b3b48e8928e8e7ef0879ac97909ad3bbdfdd21a7d86169cfcd45852 20260825000100_serialize_jumia_disconnect_purge.sql',
        'bd59247310c087e6811ff611507b462588a63fcbb43250007e15cc4d72715293 20260825000200_scope_jumia_disconnect_purge_to_locked_shop.sql',
        '7d27621520df2f173b3382fca053d7f7d9ed57999317b6c2ff2e05bef5413c2a 20260825000300_claim_jumia_discovery_and_fix_handoff.sql',
        '6d1ca4f4cc494923cd60ef008cb8cc1844a7811676c16297f551da2a67cd61b1 20260825000400_order_jumia_multi_shop_locks.sql',
        '2ef84cf47dd191d491b8be7d61238389b9a43bd43956f84fa9b3dc56d97422cd 20260825000500_schedule_jumia_orphan_authorization_sweep.sql',
        '7d8dda99f5415f36db99afc7692edbae2a438eb39223e5cb840ede0eb1bbf50f 20260825000600_harden_jumia_shop_locks_and_orphan_sweep.sql',
        '0158b4a2394428b1c259f39ef391e662f37e0e99c09a9c357eceb2c44ab82d33 20260825000700_persist_jumia_oauth_integrations_atomically.sql',
        '55494b40db1fdcc8eb8f352976a03ac9b3577d4eb94673840fd7dab4b6d73e73 20260825000800_require_legacy_jumia_self_authorization_reconnect.sql',
        '9b0d19fa7a5e6b478b6785997f03c89d263ed6f01d311776a58ad5a62f4c6ee9 20260825000900_persist_existing_jumia_authorization_rotation.sql',
        'bfd04e28d8c15b5fa354fe95060d7a222dfb4867c27e564499f3b07213ce1c3c 20260825001000_purge_displaced_jumia_authorizations.sql',
        '2fba4e5bb89671a1b26c4f51157887b2118d5cd762530ae61672de6a1adf0570 20260825001100_allow_active_jumia_view_credential_refresh.sql',
      ])
    );
  });

  it('registers the append-only sales collision repair for replay verification', () => {
    expect(rows(PENDING_SOURCES)).toContain(
      '2676132ef759384de03f6ad7eeed2f7e1e38abac02013aaca634bfb957106482 20260907111036_repair_sales_exclusion_wallet_version_collision.sql'
    );
  });

  it('registers the public active product offers policy for replay verification', () => {
    expect(rows(PENDING_SOURCES)).toContain(
      '06b8543596df16e6fa5fb5d24c6c2ef7418d34845c9189853a3187f34883b7a2 20260918000000_public_active_product_offers.sql'
    );
  });

  it('registers the offer-change feed manifest trigger for replay verification', () => {
    expect(rows(PENDING_SOURCES)).toContain(
      '7de47f950351dfd8945be917d091dc50fd5ca80948566b20eb617c5c43e83718 20260920200000_stale_feed_manifest_on_offer_change.sql'
    );
  });

  it('registers the storefront order idempotency hash probe for replay verification', () => {
    expect(rows(PENDING_SOURCES)).toContain(
      '2e7f253690d3f5b6671934792f502c734e8bb14a914bff74cfcfec86adcba7b2 20260911200000_probe_storefront_order_idempotency_hash.sql'
    );
  });

  it('keeps the quiz-live pending-source cohort unique and lexically ordered', () => {
    const repositoryPaths = EXPECTED_QUIZ_LIVE_PENDING_SOURCES.map(
      ({ repositoryPath }) => repositoryPath
    );

    expect(repositoryPaths.length).toBeGreaterThan(0);
    expect(new Set(repositoryPaths).size).toBe(repositoryPaths.length);
    expect(repositoryPaths).toEqual([...repositoryPaths].sort());

    const pendingByPath = new Map(
      rows(PENDING_SOURCES).map((row) => {
        const [sha256, filename] = row.trim().split(/\s+/);
        return [`supabase/migrations/${filename}`, sha256] as const;
      })
    );
    for (const {
      repositoryPath,
      sha256,
    } of EXPECTED_QUIZ_LIVE_PENDING_SOURCES) {
      expect(pendingByPath.get(repositoryPath)).toBe(sha256);
    }
  });
});
