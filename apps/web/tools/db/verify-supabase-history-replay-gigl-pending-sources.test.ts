import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { createReplayManifestTestWorkspace } from './replay-manifest-test-workspace.test-support';
import { verifySupabaseHistoryReplayManifest } from './verify-supabase-history-replay-manifest';

const replayManifestWorkspace = createReplayManifestTestWorkspace();
const WORKSPACE_ROOT = replayManifestWorkspace.workspaceRoot;
const GIGL_TRACKING_RETRY_REPAIR_PATH =
  'supabase/migrations/20260803000700_repair_gigl_tracking_retry_edges.sql';
const GIGL_TRACKING_RETRY_REPAIR_SHA256 =
  '281fa23f379abccdd1366f6354f107e43692c44c89a9b4bc80eb77a20efc704d';
const GIGL_RECOVERY_EDGE_REPAIRS = [
  [
    'supabase/migrations/20260804000100_repair_gigl_failed_event_recovery_scope.sql',
    'a63725b099429a1ed8fd71042ef601651b4468625c8c2a630f6783bd485a6e76',
  ],
  [
    'supabase/migrations/20260804000200_repair_gigl_notification_recovery_edges.sql',
    'dd09ef7cd898336c6424274b17891619c0b87b6c07bb8726f61e931cb67b6a19',
  ],
  [
    'supabase/migrations/20260804000300_repair_gigl_manual_failure_status_scope.sql',
    '893c97221351a03a058dfa208f33c80fd718e5b0f4d5fca4ca4ac832e7ac9cd0',
  ],
  [
    'supabase/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql',
    '866b13c1167d32cb7049e45ddf1dc886e186b8b750a550f2d33f6107de946a74',
  ],
  [
    'supabase/migrations/20260804000500_repair_gigl_monitor_backfill_join.sql',
    '3ca768d2e65684d6374c936933bcbba12178c39a73646687e9b55c3548e331dd',
  ],
] as const;

afterEach(replayManifestWorkspace.cleanUp);

function expectPendingSourceSha(
  pendingSources: readonly { repositoryPath: string; sha256: string }[],
  repositoryPath: string,
  sha256: string
) {
  expect(
    pendingSources.find((source) => source.repositoryPath === repositoryPath)
  ).toMatchObject({ sha256 });
}

describe('GIGL tracking pending replay sources', () => {
  it('pins the retry-edge repair to its checked-in bytes', async () => {
    const bytes = await readFile(
      path.join(WORKSPACE_ROOT, GIGL_TRACKING_RETRY_REPAIR_PATH)
    );

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      GIGL_TRACKING_RETRY_REPAIR_SHA256
    );
  });

  it('keeps the tenant and notification hardening migrations in the manifest', async () => {
    const result = await verifySupabaseHistoryReplayManifest(WORKSPACE_ROOT, {
      pendingRepairState: 'materialized',
    });

    expect(result.manifest.pendingSources).toHaveLength(
      EXPECTED_PENDING_SOURCES.length
    );
    for (const [repositoryPath, sha256] of [
      [
        'supabase/migrations/20260801142400_retry_gigl_definitive_notification_rejections.sql',
        '398769a0e0a4ffdae8a763d48665c4f5efd27a2fe14405069abb7bafec84a776',
      ],
      [
        'supabase/migrations/20260802000100_suppress_cross_audience_gigl_terminal_notifications.sql',
        'c24fb135c16b06aa58913be1cbdd1473e4bcfa34ecdb978bf5e345a32248f099',
      ],
      [
        'supabase/migrations/20260802000200_preserve_manual_gigl_order_terminal_status.sql',
        'f3a2d5185449f78c46b86ea3a1db9d6c9084e442f423a030f51f70e75719a793',
      ],
      [
        'supabase/migrations/20260802000300_revalidate_gigl_monitor_order_tenant.sql',
        '771305cc3f999ef5975dc6394b1db964c5b9a4a9919611ee1a1d317d9782340b',
      ],
      [
        'supabase/migrations/20260802000400_preserve_completed_gigl_order_status.sql',
        'fa4837d54de7528f9dc4a6e1e6c85ad5a90259aca2425e79a8538aeadc99f7c0',
      ],
      [
        'supabase/migrations/20260802000500_repair_gigl_monitor_tenant_revalidation.sql',
        '79f8dbbe8646df9f6fb1b1c96bce0606a9426e72ea60bd051c2cae6458678cd5',
      ],
      [
        'supabase/migrations/20260802000600_harden_gigl_monitor_tenant_revalidation.sql',
        'bcd8a9af6b82c0214871d22fbdefe07933a6069800e1edc09d999b5afb8b51a9',
      ],
      [
        'supabase/migrations/20260802000700_finalize_gigl_monitor_tenant_reconciliation.sql',
        '993db7de54f6d0ca7550abc54c4997ec00121e06100ceb9a8101c593c5d4cf7a',
      ],
      [
        'supabase/migrations/20260803000100_prevent_stale_gigl_monitor_reactivation.sql',
        '8294ae2594cac9406df2367a644e3750d6ccf26d17c0784f8f3c776ca6d798eb',
      ],
      [
        'supabase/migrations/20260803000200_repair_unowned_gigl_monitor_backfill.sql',
        'a5436eadd7450b9b25e6229d58ad18f0492f92fd6e6b5023cc3f9c9bf4c0dfc8',
      ],
      [
        'supabase/migrations/20260803000300_harden_gigl_carrier_precedence.sql',
        'd8015b4fa54ad7f1523d3b7ef6ff452aca6dc4825da283c7c91a9c8a0bd266fd',
      ],
      [
        'supabase/migrations/20260803000400_restore_booking_lock_timeout_floor.sql',
        'd1f1bd87e2e0daf2d1ef9d471558180d50e43de7827df24054455d8bddf8daee',
      ],
      [
        'supabase/migrations/20260803000500_index_gigl_monitor_claims.sql',
        '815a9b78f367cf0269a47a9908b2ff4a555ade9f10d3477248267792a4329f1f',
      ],
      [
        'supabase/migrations/20260803000600_repair_gigl_tracking_realtime_broadcast.sql',
        'effcd70e2aad319665eecc17c24a08340dc55db17adfaa86169c734c05b5a3b2',
      ],
      [GIGL_TRACKING_RETRY_REPAIR_PATH, GIGL_TRACKING_RETRY_REPAIR_SHA256],
      ...GIGL_RECOVERY_EDGE_REPAIRS,
      [
        'supabase/migrations/20260805090300_add_least_privilege_gigl_tracking_worker.sql',
        '65a27f2ef3df4ce71ad532745f748f63f69a0cdc8e69d8e5ec59372233db91ad',
      ],
      [
        'supabase/migrations/20260805091000_enable_least_privilege_gigl_tracking_login.sql',
        '67e35ce36d63d9026492bf25335492df816600f202c4904c725a90debf217b62',
      ],
      [
        'supabase/migrations/20260805113000_restore_gigl_tracking_postgrest_capability.sql',
        '98698dbda91f1d298b81b15ba6809d75dcc81d188e7ee2294cfee885a489d296',
      ],
      [
        'supabase/migrations/20260805170000_isolate_gigl_tracking_postgrest_capability.sql',
        '2cc78f981f2229b6f5a2abffe3ab750218439334ce5f1416fee28e4ade07de0a',
      ],
    ] as const) {
      expectPendingSourceSha(
        result.manifest.pendingSources,
        repositoryPath,
        sha256
      );
    }
  }, 60_000);
});
