import { createHash } from 'node:crypto';
import { applySupabaseReplaySql } from './apply-supabase-replay-sql';
import type {
  FrozenReplaySource,
  ReplaySource,
} from './supabase-history-replay-types';

type CurrentTreeSourceOptions = {
  apply: (sqlPath: string) => Promise<unknown>;
  readSource: (
    repositoryRoot: string,
    repositoryPath: string
  ) => Promise<Buffer>;
  materializeSource: (
    repositoryRoot: string,
    workdir: string,
    source: ReplaySource,
    ordinal: number
  ) => Promise<string>;
  pendingSources: readonly FrozenReplaySource[];
  postReplaySources: readonly ReplaySource[];
  repositoryRoot: string;
  startingOrdinal: number;
  workdir: string;
};

type ReplaySourceReplacement = {
  replacementPath: string;
  sourceSha256: string;
};

type ReplaySourceSupersession = {
  replacementPath: string;
};

const replaySourceReplacements = new Map<string, ReplaySourceReplacement>([
  [
    'supabase/migrations/20260727220050_shipment_tracking_realtime_broadcast.sql',
    {
      replacementPath:
        'supabase/migrations/20260803000600_repair_gigl_tracking_realtime_broadcast.sql',
      sourceSha256:
        '89b2dafdf9de92770d8a20151444a6c34602f78cb83bcc79cb20ed3ea9c21b65',
    },
  ],
  [
    'supabase/migrations/20260801141800_harden_gigl_tracking_retry_edges.sql',
    {
      replacementPath:
        'supabase/migrations/20260803000700_repair_gigl_tracking_retry_edges.sql',
      sourceSha256:
        '35bcfb114ccfdadbbb44f69b21b53dd91b8df7a9eaa875f364e3d22b354801d1',
    },
  ],
  [
    'supabase/migrations/20260801141900_scope_gigl_recovery_to_failed_event.sql',
    {
      replacementPath:
        'supabase/migrations/20260804000100_repair_gigl_failed_event_recovery_scope.sql',
      sourceSha256:
        '972030071dbeea262fdd1ccc20f4f62c07c90299d00e5fd70335617c4dd9a91d',
    },
  ],
  [
    'supabase/migrations/20260801142000_harden_gigl_notification_recovery_edges.sql',
    {
      replacementPath:
        'supabase/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql',
      sourceSha256:
        'b373ae3f70d7311004e7e4400c2b3a3c8534300e82ee01c2c9e0d3df2680b81e',
    },
  ],
  [
    'supabase/migrations/20260801142100_preserve_manual_gigl_failures_after_unknown_scans.sql',
    {
      replacementPath:
        'supabase/migrations/20260804000300_repair_gigl_manual_failure_status_scope.sql',
      sourceSha256:
        'f97c32889ae2e733d881bd7d6672cd91337936326f55e205d717bb972398ea73',
    },
  ],
  [
    'supabase/migrations/20260801142200_cleanup_unowned_gigl_monitor_backfill.sql',
    {
      replacementPath:
        'supabase/migrations/20260804000500_repair_gigl_monitor_backfill_join.sql',
      sourceSha256:
        '605a0d48a4f116e67ee626ff173b66c6c80cefa77ad606a3813aa1ea6deda62a',
    },
  ],
  [
    'supabase/migrations/20260811135000_harden_paystack_chat_order_relationship.sql',
    {
      replacementPath:
        'supabase/migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql',
      sourceSha256:
        '210c24070e7295dcdec19e10d33dd456a1dbc24891812cc74b4bfddeff808456',
    },
  ],
  [
    'supabase/migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql',
    {
      replacementPath:
        'supabase/migrations/20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql',
      sourceSha256:
        '4ed01fb7657a37530a4bdb5de152b4bf869e4b2ddaf7bc04c29f7ca131207408',
    },
  ],
  [
    'supabase/migrations/20260812170000_quiz_materialized_final_rankings_v2.sql',
    {
      replacementPath:
        'supabase/migrations/20260814230000_repair_quiz_materialized_final_rankings_v2.sql',
      sourceSha256:
        '1b3eec0aa6d442ab9f3a61149e0839a0cad6aab80ea567200c815b9e2c98dee5',
    },
  ],
  [
    'supabase/migrations/20260812173500_quiz_event_results_v2_deny_client_policy.sql',
    {
      replacementPath:
        'supabase/migrations/20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql',
      sourceSha256:
        '2a1d2341ec3631c74b9d44043db1f67f80b51012a796aea6477231bedfab98ef',
    },
  ],
  [
    'supabase/migrations/20260815103000_capture_private_expense_receipt_cleanup.sql',
    {
      replacementPath:
        'supabase/migrations/20260815220000_repair_capture_private_expense_receipt_cleanup.sql',
      sourceSha256:
        '64530e9b7d94d9e2f832a8464593af977cb0af18c727a1a1b54c62310550997b',
    },
  ],
  [
    'supabase/migrations/20260921100200_enforce_merchant_shipping_provider_policy.sql',
    {
      replacementPath:
        'supabase/migrations/20260926130000_repair_shipping_provider_policy_audit.sql',
      sourceSha256:
        'c89fb79e44148fe68caf65d99aed81de7a1ffd0d42b6ff85fbd41d9d98eceda3',
    },
  ],
]);

const replaySourceSupersessions = new Map<string, ReplaySourceSupersession>([
  [
    'supabase/migrations/20260804000200_repair_gigl_notification_recovery_edges.sql',
    {
      replacementPath:
        'supabase/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql',
    },
  ],
]);

const sha256 = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

export async function applySupabaseCurrentTreeSources(
  options: CurrentTreeSourceOptions
): Promise<void> {
  const sources: ReplaySource[] = [
    ...options.postReplaySources,
    ...options.pendingSources.map((source) => ({
      ...source,
      receiptId: `pending:${source.repositoryPath}`,
    })),
  ];

  const appliedPaths = new Set<string>();
  let ordinal = options.startingOrdinal;
  for (const source of sources) {
    const supersession = replaySourceSupersessions.get(source.repositoryPath);
    if (supersession) {
      if (!appliedPaths.has(supersession.replacementPath)) {
        throw new Error(
          `Superseded replay source requires its replacement to be applied first: ${supersession.replacementPath}`
        );
      }
      continue;
    }
    const replacement = replaySourceReplacements.get(source.repositoryPath);
    if (replacement) {
      if (source.sha256 !== replacement.sourceSha256) {
        throw new Error('Replay source hash mismatch');
      }
      const historicalBytes = await options.readSource(
        options.repositoryRoot,
        source.repositoryPath
      );
      if (sha256(historicalBytes) !== replacement.sourceSha256) {
        throw new Error('Replay source hash mismatch');
      }
      const replacementSource = sources.find(
        ({ repositoryPath }) => repositoryPath === replacement.replacementPath
      );
      if (!replacementSource) {
        throw new Error(
          `Missing replay replacement source: ${replacement.replacementPath}`
        );
      }
      if (appliedPaths.has(replacementSource.repositoryPath)) continue;
      const sqlPath = await options.materializeSource(
        options.repositoryRoot,
        options.workdir,
        replacementSource,
        ordinal
      );
      await applySupabaseReplaySql(options.apply, {
        kind: 'migration',
        ordinal,
        sqlPath,
      });
      appliedPaths.add(replacementSource.repositoryPath);
      ordinal += 1;
      continue;
    }
    if (appliedPaths.has(source.repositoryPath)) continue;
    const sqlPath = await options.materializeSource(
      options.repositoryRoot,
      options.workdir,
      source,
      ordinal
    );
    await applySupabaseReplaySql(options.apply, {
      kind: 'migration',
      ordinal,
      sqlPath,
    });
    appliedPaths.add(source.repositoryPath);
    ordinal += 1;
  }
}
